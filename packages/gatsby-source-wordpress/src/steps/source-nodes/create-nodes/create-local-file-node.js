import fs from "fs-extra"
import path from "path"
import url from "url"
import chalk from "chalk"

import retry from "async-retry"

import { createFileNodeFromBuffer } from "gatsby-source-filesystem"

import createRemoteFileNode from "./create-remote-file-node/index"

import { getStore } from "~/store"

import urlToPath from "~/utils/url-to-path"
import { formatLogMessage } from "~/utils/format-log-message"
import { stripImageSizesFromUrl } from "~/steps/source-nodes/fetch-nodes/fetch-referenced-media-items"
import { ensureSrcHasHostname } from "./process-node"

export const getFileNodeMetaBySourceUrl = sourceUrl => {
  const fileNodesMetaByUrls = getStore().getState().imageNodes.nodeMetaByUrl

  return fileNodesMetaByUrls[stripImageSizesFromUrl(sourceUrl)]
}

export const getMediaItemEditLink = node => {
  const { helpers, pluginOptions } = getStore().getState().gatsbyApi

  const { protocol, hostname } = url.parse(node?.link || pluginOptions.url)
  const baseUrl = `${protocol}//${hostname}`

  const databaseId = node.databaseId

  if (!databaseId) {
    const parentNode = node.parentHtmlNode || helpers.getNode(node.id)

    if (!parentNode?.databaseId) {
      return null
    }

    return `${baseUrl}/wp-admin/post.php?post=${parentNode.databaseId}&action=edit`
  }

  return `${baseUrl}/wp-admin/upload.php?item=${node.databaseId}`
}

export const errorPanicker = ({
  error,
  reporter,
  node,
  fetchState,
  parentName,
}) => {
  const editUrl = getMediaItemEditLink(node)

  const stepMessage = parentName ? ` in step:\n\n"${parentName}"` : ``
  const mediaItemLink = node.link ? `\nMedia item link: ${node.link}` : ``
  const editLink = `\nEdit link: ${editUrl || `N/A`}`
  const fileUrl = `\nFile url: ${node.mediaItemUrl}`

  const sharedError = `occurred while fetching media item${
    node.databaseId ? ` #${node.databaseId}` : ``
  }${stepMessage}\n${mediaItemLink}${editLink}${fileUrl}`

  const errorString =
    typeof error === `string` ? error : error && error.toString()

  const { pluginOptions } = getStore().getState().gatsbyApi
  const allow404ImagesInProduction = pluginOptions.production.allow404Images
  const allow401ImagesInProduction = pluginOptions.production.allow401Images
  const errorCodeIs404 = errorString.includes(`Response code 404`)
  const errorCodeIs401 = errorString.includes(`Response code 401`)
  const errorCode = errorCodeIs404 ? `404` : errorCodeIs401 ? `401` : null

  if (
    (allow404ImagesInProduction ||
      allow401ImagesInProduction ||
      process.env.NODE_ENV !== `production`) &&
    (errorCodeIs404 || errorCodeIs401)
  ) {
    fetchState.shouldBail = true

    reporter.log(``)
    reporter.warn(
      formatLogMessage(
        `Error ${sharedError}${
          !allow404ImagesInProduction || !allow401ImagesInProduction
            ? `\n\nThis error will fail production builds.`
            : ``
        }`
      )
    )
    reporter.log(``)

    return
  }

  if (errorString.includes(`Response code 4`)) {
    reporter.log(``)

    reporter.info(
      formatLogMessage(
        `Unrecoverable error ${sharedError}\n\nFailing the build to prevent deploying a broken site.${
          errorCode
            ? `\n\nIf you don't want ${errorCode}'s to fail your production builds, you can set the following option:

{
  options: {
    production: {
      allow${errorCode}Images: true
    }
  }
}`
            : ``
        }`
      )
    )
    reporter.panic(error)
  } else if (errorString.includes(`Response code 5`)) {
    reporter.log(``)
    reporter.info(
      formatLogMessage(
        [
          `Unrecoverable error ${sharedError}`,
          `\nYour wordpress host appears to be overloaded by our requests for images`,
          `\nIn ${chalk.bold(`gatsby-config.js`)}, try lowering the ${chalk.bold(
            `requestConcurrency`
          )} for MediaItems:`,
          `\nplugins: [
  {
    resolve: 'gatsby-source-wordpress',
    options: {
      url: 'https://mysite.com/graphql',
      type: {
        MediaItem: {
          localFile: {
            requestConcurrency: 50
          }
        }
      }
    },
  }
]`,
          `\nnote that GATSBY_CONCURRENT_REQUEST environment variable has been retired for these options`,
        ].join(`\n`)
      )
    )
    reporter.panic(error)
  } else {
    console.error(error)
    reporter.panic()
  }
}

export const getFileNodeByMediaItemNode = async ({
  mediaItemNode,
  helpers,
}) => {
  const { sourceUrl, modifiedGmt, mediaItemUrl, databaseId } = mediaItemNode

  const fileUrl = sourceUrl || mediaItemUrl

  if (!fileUrl) {
    helpers.reporter.warn(
      formatLogMessage(`Couldn't find source url for media item #${databaseId}`)
    )
    return null
  }

  const existingNodeMeta = getFileNodeMetaBySourceUrl(fileUrl)

  if (
    // この画像がすでにあり
    existingNodeMeta &&
    existingNodeMeta.id &&
    // かつ、変更されていない場合
    existingNodeMeta.modifiedGmt === modifiedGmt
  ) {
    let node = await helpers.getNode(existingNodeMeta.id)

    // キャッシュしたノードのメタ情報は、必ずしも File であるとは限らない
    // そのため、取得したものが File ノードでなければ、File ノードを返すようにする
    if (node && node.internal && node.internal.type !== `File`) {
      if (node.localFile && node.localFile.id) {
        // 対応するファイルノードを探す
        node = await helpers.getNode(node.localFile.id)
      } else {
        return null
      }
    }

    return node
  }

  return null
}

const failedImageUrls = new Set()

export const createLocalFileNode = async ({
  mediaItemNode,
  parentName,
  skipExistingNode = false,
}) => {
  const state = getStore().getState()
  const { helpers, pluginOptions } = state.gatsbyApi

  const existingNode = !skipExistingNode
    ? await getFileNodeByMediaItemNode({
        mediaItemNode,
        helpers,
      })
    : null

  if (existingNode) {
    return existingNode
  }

  const {
    store: gatsbyStore,
    cache,
    createNodeId,
    reporter,
    actions: { createNode },
  } = helpers

  let { mediaItemUrl, modifiedGmt, mimeType, title, fileSize } = mediaItemNode

  if (!mediaItemUrl || failedImageUrls.has(mediaItemUrl)) {
    return null
  }

  const { wpUrl } = state.remoteSchema
  mediaItemUrl = ensureSrcHasHostname({ wpUrl, src: mediaItemUrl })

  const { excludeByMimeTypes, maxFileSizeBytes } =
    // eslint-disable-next-line no-unsafe-optional-chaining
    pluginOptions.type?.MediaItem?.localFile

  // このファイルが maxFileSizeBytes より大きい場合は、リモートファイルを取得しない
  if (fileSize > maxFileSizeBytes) {
    getStore().dispatch.postBuildWarningCounts.incrementMaxFileSizeBytesExceeded()
    return null
  }

  // この種類のファイルが除外されている場合は、リモートファイルを取得しない
  if (excludeByMimeTypes.includes(mimeType)) {
    getStore().dispatch.postBuildWarningCounts.incrementMimeTypeExceeded()
    return null
  }

  const hardCachedFileRelativePath = urlToPath(mediaItemUrl)
  const hardCachedMediaFilesDirectory = `${process.cwd()}/.wordpress-cache`

  const hardCachedFilePath =
    hardCachedMediaFilesDirectory + hardCachedFileRelativePath

  const hardCacheMediaFiles =
    (process.env.NODE_ENV === `development` &&
      pluginOptions.develop.hardCacheMediaFiles) ||
    (process.env.NODE_ENV === `production` &&
      pluginOptions.production.hardCacheMediaFiles)

  const fetchState = {
    shouldBail: false,
  }

  const createFileNodeRequirements = {
    parentNodeId: mediaItemNode.id,
    store: gatsbyStore,
    cache,
    createNode,
    createNodeId,
  }

  let remoteFileNode

  if (hardCacheMediaFiles) {
    // .wordpress-cache/wp-content にファイルがあるかを確認する
    // あれば、wp から取得する代わりに、
    // それを使ってノードを作成する
    try {
      const buffer = await fs.readFile(hardCachedFilePath)
      remoteFileNode = await createFileNodeFromBuffer({
        buffer,
        name: title,
        ext: path.extname(mediaItemUrl),
        ...createFileNodeRequirements,
      })
    } catch (e) {
      // エラーは無視する。画像がなければ下でダウンロードする
    }
  }

  if (!remoteFileNode) {
    // そうでなければダウンロードする必要がある
    remoteFileNode = await retry(
      async () => {
        if (fetchState.shouldBail) {
          failedImageUrls.add(mediaItemUrl)
          return null
        }

        const { hostname: wpUrlHostname } = url.parse(wpUrl)
        const { hostname: mediaItemHostname } = url.parse(mediaItemUrl)

        const htaccessCredentials = pluginOptions.auth.htaccess

        // メディアアイテムが s3 のような別の URL でホストされている場合、
        // htaccess の認証情報を使うと 400 エラーになる
        const shouldUseHtaccessCredentials = wpUrlHostname === mediaItemHostname

        const auth =
          htaccessCredentials && shouldUseHtaccessCredentials
            ? {
                htaccess_pass: htaccessCredentials?.password,
                htaccess_user: htaccessCredentials?.username,
              }
            : null

        // ここでエラーになった場合は、1 階層上の fetch-referenced-media-items.js で捕捉され、リクエストキューの末尾に入れ直される
        const node = await createRemoteFileNode({
          url: mediaItemUrl,
          auth,
          ...createFileNodeRequirements,
          reporter,
          pluginOptions,
        })

        return node
      },
      {
        retries: 3,
        factor: 1.1,
        minTimeout: 5000,
        onRetry: error =>
          errorPanicker({
            error,
            reporter,
            node: mediaItemNode,
            fetchState,
            parentName,
          }),
      }
    )
  }

  if (!remoteFileNode) {
    return null
  }

  // キャッシュ用に、その id と URL をストアに追加する。
  // 次回このノードを touch できるようにし、
  // 後でソース URL から id を簡単に引けるようにするためである
  getStore().dispatch.imageNodes.pushNodeMeta({
    id: remoteFileNode.id,
    sourceUrl: mediaItemUrl,
    modifiedGmt,
  })

  if (hardCacheMediaFiles) {
    try {
      // ディレクトリが存在するようにする
      await fs.ensureDir(path.dirname(hardCachedFilePath))
      // ダウンロードしたファイルを既存のディレクトリへコピーする
      await fs.copyFile(remoteFileNode.absolutePath, hardCachedFilePath)
    } catch (e) {
      helpers.reporter.panic(e)
    }
  }

  // そしてそれを使う
  return remoteFileNode
}
