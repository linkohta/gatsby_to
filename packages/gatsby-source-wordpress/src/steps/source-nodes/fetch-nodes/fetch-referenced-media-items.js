import chunk from "lodash/chunk"
import { getStore } from "~/store"
import atob from "atob"
import { filesize } from "filesize"
import PQueue from "p-queue"
import { createLocalFileNode } from "../create-nodes/create-local-file-node"
import { paginatedWpNodeFetch, normalizeNode } from "./fetch-nodes-paginated"
import { buildTypeName } from "~/steps/create-schema-customization/helpers"
import fetchGraphql from "~/utils/fetch-graphql"
import { getFileNodeMetaBySourceUrl } from "~/steps/source-nodes/create-nodes/create-local-file-node"
import uniq from "lodash/uniq"
import urlUtil from "url"
import path from "path"
import { getPluginOptions } from "~/utils/get-gatsby-api"
import { formatLogMessage } from "~/utils/format-log-message"
import { getPlaceholderUrlFromMediaItemNode } from "../create-nodes/process-node"

const nodeFetchConcurrency = 2

const concurrency = Number(process.env.GATSBY_CONCURRENT_DOWNLOAD ?? 200)
const adjustedConcurrency = Number(concurrency ?? 200) - nodeFetchConcurrency
const normalizedConcurrency =
  adjustedConcurrency <= nodeFetchConcurrency
    ? concurrency
    : adjustedConcurrency

const mediaFileFetchQueue = new PQueue({
  concurrency: normalizedConcurrency,
  carryoverIntervalCount: true,
})

const mediaNodeFetchQueue = new PQueue({
  concurrency: nodeFetchConcurrency,
  carryoverIntervalCount: true,
})

const previouslyRetriedPromises = {}

const pushPromiseOntoRetryQueue = ({
  node,
  helpers,
  createContentDigest,
  actions,
  queue,
  retryKey,
  retryPromise,
}) => {
  queue.add(async () => {
    const timesRetried = previouslyRetriedPromises[retryKey] || 0

    if (timesRetried >= 2) {
      // これを 2 回以上リトライしている場合は、少し待つ。
      await new Promise(resolve =>
        setTimeout(() => resolve(), timesRetried * 500)
      )
    }

    try {
      await retryPromise({
        createContentDigest,
        actions,
        helpers,
        node,
        queue,
        retryKey,
        retryPromise,
        timesRetried,
      })
    } catch (error) {
      // 終了すべきエラーは、1 階層下の createLocalFileNode で
      // 処理される
      //
      // これをまだキューに入れ直していなければ、
      // 後でもう一度試せるよう、
      // キューの末尾に追加する
      if (timesRetried < 5) {
        if (timesRetried > 1) {
          helpers.reporter.info(
            `pushing ${retryKey} to the end of the request queue.`
          )

          helpers.reporter.info(
            `Previously retried ${timesRetried} times already.`
          )
        }

        previouslyRetriedPromises[retryKey] = timesRetried + 1

        pushPromiseOntoRetryQueue({
          node,
          helpers,
          createContentDigest,
          actions,
          queue,
          retryKey,
          retryPromise,
        })
      } else {
        helpers.reporter.info(
          `\n\nalready re-queued ${retryKey} 5 times :( sorry.\nTry lowering process.env.GATSBY_CONCURRENT_DOWNLOAD.\nIt's currently set to ${process.env.GATSBY_CONCURRENT_DOWNLOAD}\n\n`
        )
        // これはキューの中ですでに試している
        // あきらめるしかない :(
        helpers.reporter.panic(error)
      }
    }
  })
}

export const addImageCDNFieldsToNode = (node, pluginOptions) => {
  if (!node?.__typename?.includes(`MediaItem`)) {
    return node
  }

  const placeholderUrl = getPlaceholderUrlFromMediaItemNode(node, pluginOptions)

  const url = node.sourceUrl || node.mediaItemUrl

  const filename =
    node?.mediaDetails?.file?.split(`/`)?.pop() ||
    path.basename(urlUtil.parse(url).pathname)

  return {
    ...node,
    url,
    contentType: node.contentType,
    mimeType: node.mimeType,
    filename,
    filesize: node?.mediaDetails?.fileSize,
    width: node?.mediaDetails?.width,
    height: node?.mediaDetails?.height,
    placeholderUrl:
      placeholderUrl ?? node?.mediaDetails?.sizes?.[0]?.sourceUrl ?? url,
  }
}

export const createMediaItemNode = async ({
  node,
  helpers,
  createContentDigest,
  actions,
  parentName,
  allMediaItemNodes = [],
}) => {
  const existingNode = await helpers.getNode(node.id)

  if (existingNode) {
    return existingNode
  }

  getStore().dispatch.logger.incrementActivityTimer({
    typeName: `MediaItem`,
    by: 1,
  })

  allMediaItemNodes.push(node)

  let resolveFutureNode
  const futureNode = new Promise(resolve => {
    resolveFutureNode = resolve
  })

  pushPromiseOntoRetryQueue({
    node,
    helpers,
    createContentDigest,
    actions,
    queue: mediaFileFetchQueue,
    retryKey: node.mediaItemUrl,
    retryPromise: async ({
      createContentDigest,
      actions,
      helpers,
      node,
      retryKey,
      timesRetried,
    }) => {
      const fetchTimeout = setTimeout(() => {
        helpers.reporter.log(
          formatLogMessage(
            `Fetching ${
              node.mediaItemUrl
            } is taking a long time time (longer than 15 seconds). This file is ${filesize(
              node.fileSize,
              // filesize 7 以降は既定が SI 単位（1 kB = 1000 B）なので、これまでと同じ表記（1 KB = 1024 B）を指定する
              { standard: `jedec` }
            )}`
          )
        )
      }, 15000)

      const pluginOptions = getPluginOptions()

      const { createFileNodes } = pluginOptions.type.MediaItem

      const localFileNode = createFileNodes
        ? await createLocalFileNode({
            mediaItemNode: node,
            helpers,
            parentName,
          })
        : null

      clearTimeout(fetchTimeout)

      if (timesRetried > 1) {
        helpers.reporter.info(
          `Successfully fetched ${retryKey} after retrying ${timesRetried} times`
        )
      }

      node = addImageCDNFieldsToNode(
        {
          ...node,
          parent: null,
          internal: {
            contentDigest: createContentDigest(node),
            type: buildTypeName(`MediaItem`),
          },
        },
        pluginOptions
      )

      if (localFileNode?.id) {
        node.localFile = {
          id: localFileNode?.id,
        }
      }

      const normalizedNode = normalizeNode({ node, nodeTypeName: `MediaItem` })

      await actions.createNode(normalizedNode)
      return resolveFutureNode(node)
    },
  })

  return futureNode
}

const urlToFileExtension = url => {
  const { pathname } = urlUtil.parse(url)

  const fileExtension = path.extname(pathname)

  return fileExtension
}

export const stripImageSizesFromUrl = url => {
  const fileExtension = urlToFileExtension(url)

  const imageSizesPattern = new RegExp(
    // eslint-disable-next-line no-useless-escape
    `(?:[-_]([0-9]+)x([0-9]+))${fileExtension ? `\.${fileExtension}` : ``}`
  )

  let urlWithoutSizes = url.replace(imageSizesPattern, ``)

  if (urlWithoutSizes !== url && fileExtension) {
    urlWithoutSizes = `${urlWithoutSizes}${fileExtension}`
  }

  return urlWithoutSizes
}

const createScaledImageUrl = url => {
  const fileExtension = urlToFileExtension(url)

  const isAlreadyScaled = url.includes(`-scaled${fileExtension || ``}`)

  if (isAlreadyScaled) {
    return url
  }

  let scaledUrl

  if (fileExtension) {
    scaledUrl = url.replace(fileExtension, `-scaled${fileExtension}`)
  } else {
    scaledUrl = `${url}-scaled`
  }

  return scaledUrl
}

// 画像の URL の配列を受け取り、渡された URL の中に画像のリサイズを示すと思われる
// 記号が含まれていれば、追加の URL を加えて返す
// たとえば https://site.com/wp-content/uploads/01/your-image-500x1000.jpeg であれば、
// https://site.com/wp-content/uploads/01/your-image.jpeg を配列に追加する
// これが必要なのは、画像ノードを完全なソース URL でしか取得できないためである。
// すべての URL からリサイズの記号を単純に取り除くのは誤りである。
// そのパターンを含むフルサイズの画像がアップロードされることもあり、その場合は
// フルサイズの URL に 500x1000 が含まれるので、取り除くとその画像ノードを
// 二度と取得できなくなる。
const processAndDedupeImageUrls = urls =>
  uniq(
    urls.reduce((accumulator, url) => {
      const scaledUrl = createScaledImageUrl(url)
      accumulator.push(scaledUrl)

      const strippedUrl = stripImageSizesFromUrl(url)

      // URL に画像サイズが含まれていなければ、特別なことは何もしない
      if (strippedUrl === url) {
        return accumulator
      }

      accumulator.push(strippedUrl)

      const scaledStrippedUrl = createScaledImageUrl(strippedUrl)
      accumulator.push(scaledStrippedUrl)

      return accumulator
    }, urls)
  )

export const fetchMediaItemsBySourceUrl = async ({
  mediaItemUrls,
  selectionSet,
  builtFragments,
  createContentDigest,
  actions,
  helpers,
  allMediaItemNodes = [],
}) => {
  const processedMediaItemUrls = processAndDedupeImageUrls(mediaItemUrls)

  const { cachedMediaItemNodeIds, uncachedMediaItemUrls } =
    processedMediaItemUrls.reduce(
      (accumulator, url) => {
        const { id } = getFileNodeMetaBySourceUrl(url) || {}

        // キャッシュした画像があり、そのキャッシュした画像をまだ記録していない場合
        if (id && !accumulator.cachedMediaItemNodeIds.includes(id)) {
          // 保存する
          accumulator.cachedMediaItemNodeIds.push(id)
        } else if (!id) {
          // そうでなければ、このメディアアイテムを URL で取得する必要がある
          accumulator.uncachedMediaItemUrls.push(url)
        }

        return accumulator
      },
      { cachedMediaItemNodeIds: [], uncachedMediaItemUrls: [] }
    )

  // 以前にキャッシュした id から、それらのノードを取得する
  const previouslyCachedMediaItemNodes = await Promise.all(
    cachedMediaItemNodeIds.map(async nodeId => {
      const node = await helpers.getNode(nodeId)

      const parentNode =
        node?.internal?.type === `File` && node?.parent
          ? helpers.getNode(node.parent)
          : null

      return parentNode || node
    })
  )

  const {
    schema: { perPage },
  } = getPluginOptions()

  // キャッシュしていないメディアアイテムを、すべてチャンクに分ける
  const mediaItemUrlsPages = chunk(uncachedMediaItemUrls, perPage)

  // 非同期のキューを使っているので、完了を知る手段が必要である
  // この resolve 関数をキューの関数に渡し、完了したときに
  // 知らせてもらう

  // 取得するメディアアイテムがないので、
  // この Promise を解決する必要がある
  // そうしないと、下で解決されないままになる。
  if (!mediaItemUrlsPages.length) {
    return Promise.resolve(previouslyCachedMediaItemNodes)
  }

  const allPromises = []
  // キャッシュしていないすべての画像について、順に処理してすべて取得する
  for (const [index, sourceUrls] of mediaItemUrlsPages.entries()) {
    const curPromise = new Promise(resolve => {
      pushPromiseOntoRetryQueue({
        helpers,
        createContentDigest,
        actions,
        queue: mediaNodeFetchQueue,
        retryKey: `Media Item by sourceUrl query #${index}, digest: ${createContentDigest(
          sourceUrls.join()
        )}`,
        retryPromise: async () => {
          const query = /* GraphQL */ `
            query MEDIA_ITEMS {
              ${sourceUrls
                .map(
                  (sourceUrl, index) => /* GraphQL */ `
                mediaItem__index_${index}: mediaItem(id: "${sourceUrl}", idType: SOURCE_URL) {
                  ...MediaItemFragment
                }
              `
                )
                .join(` `)}
            }

            fragment MediaItemFragment on MediaItem {
              ${selectionSet}
            }

            ${builtFragments || ``}
          `

          const { data } = await fetchGraphql({
            query,
            variables: {
              first: perPage,
              after: null,
            },
            errorContext: `Error occurred while fetching "MediaItem" nodes in inline html.`,
          })

          // 各メディアアイテムを、単一ノード用のルートフィールドで取得しているので、
          // 必要なのはレスポンスの各プロパティの値だけである
          // null が返るものは、ソース URL と、ソース URL からリサイズのパターンを除いたものの
          // 両方を取得しようとした結果である。データを返すのは完全なソース URL だけなので、
          // null が含まれることになる
          const thisPagesNodes = Object.values(data).filter(Boolean)

          // 受け取った WPGraphQL のノードから Gatsby のノードを作成する
          const nodes = await Promise.all(
            thisPagesNodes.map(node =>
              createMediaItemNode({
                node,
                helpers,
                createContentDigest,
                actions,
                allMediaItemNodes,
                parentName: `Fetching referenced MediaItem nodes by sourceUrl`,
              })
            )
          )

          nodes.forEach((node, index) => {
            if (!node || !node?.localFile?.id) {
              return
            }

            // 以前に取得したノードは、このようにしてキャッシュしている。
            getStore().dispatch.imageNodes.pushNodeMeta({
              id: node.localFile.id,
              sourceUrl: sourceUrls[index],
              modifiedGmt: node.modifiedGmt,
            })
          })

          resolve(nodes)
        },
      })
    })
    allPromises.push(curPromise)
  }

  await mediaNodeFetchQueue.onIdle()
  await mediaFileFetchQueue.onIdle()

  const allResults = await Promise.all(allPromises)
  return [...previouslyCachedMediaItemNodes, ...allResults.flat()]
}

export const fetchMediaItemsById = async ({
  mediaItemIds,
  settings,
  url,
  selectionSet,
  builtFragments,
  createContentDigest,
  actions,
  helpers,
  typeInfo,
}) => {
  const newMediaItemIds = mediaItemIds.filter(id => !helpers.getNode(id))

  const {
    schema: { perPage },
  } = getPluginOptions()

  const chunkedIds = chunk(newMediaItemIds, perPage)

  if (!newMediaItemIds.length) {
    return Promise.resolve([])
  }

  const allMediaItemNodes = []
  const allPromises = []

  for (const [index, relayIds] of chunkedIds.entries()) {
    const curPromise = new Promise(resolve => {
      pushPromiseOntoRetryQueue({
        helpers,
        createContentDigest,
        actions,
        queue: mediaNodeFetchQueue,
        retryKey: `Media Item query #${index}, digest: ${createContentDigest(
          relayIds.join()
        )}`,
        retryPromise: async () => {
          // relay の id は、attachment:89381 のような文字列を base64 でエンコードしたものである
          // 89381 がクエリに必要な id である
          // そこで : で分割し、配列の最後の要素である id を取得する
          // relay の id でメディアアイテムの一覧を取得できるようになれば、atob は取り除ける
          const ids = relayIds.map(id => atob(id).split(`:`).slice(-1)[0])

          const query = `
          query MEDIA_ITEMS($in: [ID]) {
            mediaItems(first: ${perPage}, where:{ in: $in }) {
              nodes {
                ${selectionSet}
              }
            }
          }

          ${builtFragments || ``}
        `
          const allNodesOfContentType = await paginatedWpNodeFetch({
            first: perPage,
            contentTypePlural: typeInfo.pluralName,
            nodeTypeName: typeInfo.nodesTypeName,
            query,
            url,
            helpers,
            settings,
            in: ids,
            // これにより、キューの末尾でのリトライができる
            throwFetchErrors: true,
          })

          const nodes = await Promise.all(
            allNodesOfContentType.map(node =>
              createMediaItemNode({
                node,
                helpers,
                createContentDigest,
                actions,
                allMediaItemNodes,
                referencedMediaItemNodeIds: mediaItemIds,
                parentName: `Fetching referenced MediaItem nodes by id`,
              })
            )
          )

          resolve(nodes)
        },
      })
    })
    allPromises.push(curPromise)
  }

  await mediaNodeFetchQueue.onIdle()
  await mediaFileFetchQueue.onIdle()

  const allResults = await Promise.all(allPromises)
  return allResults.flat()
}

export default async function fetchReferencedMediaItemsAndCreateNodes({
  referencedMediaItemNodeIds,
  mediaItemUrls,
}) {
  const state = getStore().getState()
  const queryInfo = state.remoteSchema.nodeQueries.mediaItems
  const { helpers, pluginOptions } = state.gatsbyApi

  // pluginOptions で除外されている場合は、メディアアイテムを取得しない
  if (pluginOptions.type?.MediaItem?.exclude) {
    return []
  }

  const { createContentDigest, actions } = helpers
  const { url } = pluginOptions
  const { typeInfo, settings, selectionSet, builtFragments } = queryInfo

  let createdNodes = []

  if (referencedMediaItemNodeIds?.length) {
    const nodesSourcedById = await fetchMediaItemsById({
      mediaItemIds: referencedMediaItemNodeIds,
      settings,
      url,
      selectionSet,
      builtFragments,
      createContentDigest,
      actions,
      helpers,
      typeInfo,
    })

    createdNodes = nodesSourcedById
  }

  if (mediaItemUrls?.length) {
    const nodesSourcedByUrl = await fetchMediaItemsBySourceUrl({
      mediaItemUrls,
      settings,
      url,
      selectionSet,
      builtFragments,
      createContentDigest,
      actions,
      helpers,
      typeInfo,
    })

    createdNodes = [...createdNodes, ...nodesSourcedByUrl]
  }

  return createdNodes.filter(Boolean)
}
