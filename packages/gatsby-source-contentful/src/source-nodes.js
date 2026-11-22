// @ts-check
import _ from "lodash"
import {
  addNodeToExistingNodesCache,
  getExistingCachedNodes,
  removeNodeFromExistingNodesCache,
} from "./backreferences"
import { untilNextEventLoopTick } from "./utils"

import { downloadContentfulAssets } from "./download-contentful-assets"
import { fetchContent } from "./fetch"
import {
  buildEntryList,
  buildForeignReferenceMap,
  buildResolvableSet,
  createAssetNodes,
  createNodesForContentType,
  makeId,
} from "./normalize"
import { createPluginConfig } from "./plugin-options"
import { CODES } from "./report"
import { hasFeature } from "gatsby-plugin-utils/has-feature"

const conflictFieldPrefix = `contentful`

// restrictedNodeFields の出典は https://www.gatsbyjs.com/docs/node-interface/
const restrictedNodeFields = [
  `children`,
  `contentful_id`,
  `fields`,
  `id`,
  `internal`,
  `parent`,
]

const CONTENT_DIGEST_COUNTER_SEPARATOR = `_COUNT_`

async function isOnline() {
  return (await import(`is-online`)).default()
}

/***
 * ローカライズのアルゴリズム
 *
 * 1. 解決可能な ID の一覧を作る。ここではデフォルトの id だけを考え、
 * ローカライズされた id は考えない
 * 2. id 同士の対応付けを作る。ここでもローカライズは考えない。
 * 3. エントリーとアセットを作成するときに、ローカライズされた各ノードについて、
 * できるだけローカライズされた版を作る。つまり、ローカライズされたフィールドがあれば
 * それを、なければフォールバックのフィールドかデフォルトのフィールドを使う。
 */
export async function sourceNodes(
  {
    actions,
    getNode,
    createNodeId,
    store,
    cache,
    getCache,
    reporter,
    parentSpan,
  },
  pluginOptions
) {
  const {
    createNode: originalCreateNode,
    touchNode,
    deleteNode: originalDeleteNode,
    unstable_createNodeManifest,
    enableStatefulSourceNodes,
  } = actions

  if (hasFeature(`stateful-source-nodes`)) {
    enableStatefulSourceNodes()
  }

  const pluginConfig = createPluginConfig(pluginOptions)

  // バックリファレンスを探すときの検索を速くするため、createNode を包んでノードをメモリにキャッシュできるようにする
  const createNode = node => {
    addNodeToExistingNodesCache(node)

    return originalCreateNode(node)
  }

  const deleteNode = node => {
    removeNodeFromExistingNodesCache(node)

    return originalDeleteNode(node)
  }

  // 既存の Contentful ノードすべての配列
  const { existingNodes, memoryNodeCountsBySysType } =
    await getExistingCachedNodes({
      actions,
      getNode,
      pluginConfig,
    })

  // ユーザーがオフラインだと分かっている場合は、キャッシュした結果を返す
  // ただし本番ビルドでは、最新のデータを取得できなければ必ず失敗させる
  if (
    !(await isOnline()) &&
    process.env.GATSBY_CONTENTFUL_OFFLINE === `true` &&
    process.env.NODE_ENV !== `production`
  ) {
    reporter.info(`Using Contentful Offline cache ⚠️`)
    reporter.info(
      `Cache may be invalidated if you edit package.json, gatsby-node.js or gatsby-config.js files`
    )

    return
  } else if (process.env.GATSBY_CONTENTFUL_OFFLINE) {
    reporter.info(
      `Note: \`GATSBY_CONTENTFUL_OFFLINE\` was set but it either was not \`true\`, we _are_ online, or we are in production mode, so the flag is ignored.`
    )
  }

  const sourceId = `${pluginConfig.get(`spaceId`)}-${pluginConfig.get(
    `environment`
  )}`

  const fetchActivity = reporter.activityTimer(`Contentful: Fetch data`, {
    parentSpan,
  })

  fetchActivity.start()

  const CACHE_SYNC_TOKEN = `contentful-sync-token-${sourceId}`
  const CACHE_CONTENT_TYPES = `contentful-content-types-${sourceId}`
  const CACHE_FOREIGN_REFERENCE_MAP_STATE = `contentful-foreign-reference-map-state-${sourceId}`

  /*
   * Contentful の同期 API は、2 回目以降の呼び出しでは変更されたデータだけを返す。
   *
   * 場合によっては、特にリッチテキストのフィールドを使っていると、参照先のエントリーの
   * データが欠けることがある。すると参照の照合が壊れる。
   *
   * これを回避するため、最初の同期のデータをキャッシュし、以降の同期の
   * すべてのデータとマージする。その後、Contentful JS SDK で
   * 参照を解決する。
   */
  const syncToken =
    store.getState().status.plugins?.[`gatsby-source-contentful`]?.[
      CACHE_SYNC_TOKEN
    ]
  const isCachedBuild = !!syncToken

  // Contentful からの実際のデータ取得
  const {
    currentSyncData,
    tagItems,
    defaultLocale,
    locales: allLocales = [],
    space,
  } = await fetchContent({ syncToken, pluginConfig, reporter })

  const contentTypeItems = await cache.get(CACHE_CONTENT_TYPES)

  const locales = allLocales.filter(pluginConfig.get(`localeFilter`))
  reporter.verbose(
    `Default locale: ${defaultLocale}. All locales: ${allLocales
      .map(({ code }) => code)
      .join(`, `)}`
  )
  if (allLocales.length !== locales.length) {
    reporter.verbose(
      `After plugin.options.localeFilter: ${locales
        .map(({ code }) => code)
        .join(`, `)}`
    )
  }
  if (locales.length === 0) {
    reporter.panic({
      id: CODES.LocalesMissing,
      context: {
        sourceMessage: `Please check if your localeFilter is configured properly. Locales '${allLocales
          .map(item => item.code)
          .join(`,`)}' were found but were filtered down to none.`,
      },
    })
  }

  // syncToken を更新する
  const nextSyncToken = currentSyncData?.nextSyncToken

  actions.setPluginStatus({
    [CACHE_SYNC_TOKEN]: nextSyncToken,
  })

  fetchActivity.end()

  // データ取得の結果を処理し、GraphQL のエンティティに変換する
  const processingActivity = reporter.activityTimer(
    `Contentful: Process data`,
    {
      parentSpan,
    }
  )
  processingActivity.start()

  // 既存、新規、更新されたノードを報告する
  const nodeCounts = {
    newEntry: 0,
    newAsset: 0,
    updatedEntry: 0,
    updatedAsset: 0,
    deletedEntry: currentSyncData?.deletedEntries?.length || 0,
    deletedAsset: currentSyncData?.deletedAssets?.length || 0,
  }

  currentSyncData?.entries?.forEach(entry =>
    entry.sys.revision === 1 ? nodeCounts.newEntry++ : nodeCounts.updatedEntry++
  )
  currentSyncData?.assets?.forEach(asset =>
    asset.sys.revision === 1 ? nodeCounts.newAsset++ : nodeCounts.updatedAsset++
  )

  reporter.info(`Contentful: ${nodeCounts.newEntry} new entries`)
  reporter.info(`Contentful: ${nodeCounts.updatedEntry} updated entries`)
  reporter.info(`Contentful: ${nodeCounts.deletedEntry} deleted entries`)
  reporter.info(
    `Contentful: ${
      memoryNodeCountsBySysType.Entry / locales.length
    } cached entries`
  )
  reporter.info(`Contentful: ${nodeCounts.newAsset} new assets`)
  reporter.info(`Contentful: ${nodeCounts.updatedAsset} updated assets`)
  reporter.info(
    `Contentful: ${
      memoryNodeCountsBySysType.Asset / locales.length
    } cached assets`
  )
  reporter.info(`Contentful: ${nodeCounts.deletedAsset} deleted assets`)

  reporter.verbose(`Building Contentful reference map`)

  const entryList = buildEntryList({ contentTypeItems, currentSyncData })
  const { assets } = currentSyncData

  // 解決可能な id のマップを作り、リンクを作成するときに照合できるように
  // する。
  const resolvable = buildResolvableSet({
    existingNodes,
    entryList,
    assets,
  })

  const previousForeignReferenceMapState = await cache.get(
    CACHE_FOREIGN_REFERENCE_MAP_STATE
  )
  // ノードの挿入を始める前に、外部参照のマップを作る
  const foreignReferenceMapState = buildForeignReferenceMap({
    contentTypeItems,
    entryList,
    resolvable,
    defaultLocale,
    space,
    useNameForId: pluginConfig.get(`useNameForId`),
    previousForeignReferenceMapState,
    deletedEntries: currentSyncData?.deletedEntries,
  })

  await cache.set(CACHE_FOREIGN_REFERENCE_MAP_STATE, foreignReferenceMapState)
  const foreignReferenceMap = foreignReferenceMapState.backLinks

  reporter.verbose(`Resolving Contentful references`)

  let newOrUpdatedEntries = new Set()
  entryList.forEach(entries => {
    entries.forEach(entry => {
      newOrUpdatedEntries.add(`${entry.sys.id}___${entry.sys.type}`)
    })
  })

  const { deletedEntries, deletedAssets } = currentSyncData
  const deletedEntryGatsbyReferenceIds = new Set()

  function deleteContentfulNode(node) {
    const normalizedType = node.sys.type.startsWith(`Deleted`)
      ? node.sys.type.substring(`Deleted`.length)
      : node.sys.type

    const localizedNodes = locales
      .map(locale => {
        const nodeId = createNodeId(
          makeId({
            spaceId: space.sys.id,
            id: node.sys.id,
            type: normalizedType,
            currentLocale: locale.code,
            defaultLocale,
          })
        )
        // 後で取り除けるよう、削除されたノードの id を集める
        deletedEntryGatsbyReferenceIds.add(nodeId)
        return getNode(nodeId)
      })
      .filter(node => node)

    localizedNodes.forEach(node => {
      // typeOwners を埋めてエラーを避けるため、先に touchNode を呼ぶ
      touchNode(node)
      deleteNode(node)
    })
  }

  if (deletedEntries.length || deletedAssets.length) {
    const deletionActivity = reporter.activityTimer(
      `Contentful: Deleting nodes and assets`,
      {
        parentSpan,
      }
    )
    deletionActivity.start()
    deletedEntries.forEach(deleteContentfulNode)
    deletedAssets.forEach(deleteContentfulNode)
    deletionActivity.end()
  }

  // 更新されてはいないが、逆方向のリンクの追加または削除が必要な既存のエントリーノードを更新する。
  let existingNodesThatNeedReverseLinksUpdateInDatastore = new Set()

  if (isCachedBuild) {
    existingNodes.forEach(n => {
      if (
        !(
          n.sys.type === `Entry` &&
          !newOrUpdatedEntries.has(`${n.id}___${n.sys.type}`) &&
          !deletedEntryGatsbyReferenceIds.has(n.id)
        )
      ) {
        return
      }

      if (
        n.contentful_id &&
        foreignReferenceMap[`${n.contentful_id}___${n.sys.type}`]
      ) {
        foreignReferenceMap[`${n.contentful_id}___${n.sys.type}`].forEach(
          foreignReference => {
            const { name, id: contentfulId, type, spaceId } = foreignReference

            const nodeId = createNodeId(
              makeId({
                spaceId,
                id: contentfulId,
                type,
                currentLocale: n.node_locale,
                defaultLocale,
              })
            )

            // 参照フィールドがなければ新しく作成する
            if (!n[name]) {
              existingNodesThatNeedReverseLinksUpdateInDatastore.add(n)
              n[name] = [nodeId]
              return
            }

            // まだない参照を参照フィールドに追加する
            if (n[name] && !n[name].includes(nodeId)) {
              existingNodesThatNeedReverseLinksUpdateInDatastore.add(n)
              n[name].push(nodeId)
            }
          }
        )
      }

      // 削除されたノードへの参照を取り除く
      if (n.contentful_id && deletedEntryGatsbyReferenceIds.size) {
        Object.keys(n).forEach(name => {
          // @todo スキーマに基づいて参照フィールドを検出する。次のバージョンでは実現しやすくなるはずである。
          if (!name.endsWith(`___NODE`)) {
            return
          }
          if (Array.isArray(n[name])) {
            n[name] = n[name].filter(referenceId => {
              const shouldRemove =
                deletedEntryGatsbyReferenceIds.has(referenceId)
              if (shouldRemove) {
                existingNodesThatNeedReverseLinksUpdateInDatastore.add(n)
              }
              return !shouldRemove
            })
          } else {
            const referenceId = n[name]
            if (deletedEntryGatsbyReferenceIds.has(referenceId)) {
              existingNodesThatNeedReverseLinksUpdateInDatastore.add(n)
              n[name] = null
            }
          }
        })
      }
    })
  }

  // 必要であれば node が GC できるようにする
  // @ts-ignore
  newOrUpdatedEntries = undefined
  await untilNextEventLoopTick()

  // 逆方向のリンクを変更したノードに対しては `createNode` を呼び出す必要がある。
  // そうしないと、変更が実際には保存されない
  if (existingNodesThatNeedReverseLinksUpdateInDatastore.size) {
    let existingNodesLoopCount = 0
    for (const node of existingNodesThatNeedReverseLinksUpdateInDatastore) {
      function addChildrenToList(node, nodeList = [node]) {
        for (const childNodeId of node?.children ?? []) {
          const childNode = getNode(childNodeId)
          if (
            childNode &&
            childNode.internal.owner === `gatsby-source-contentful`
          ) {
            nodeList.push(childNode)
            addChildrenToList(childNode)
          }
        }
        return nodeList
      }

      const nodeAndDescendants = addChildrenToList(node)
      for (const nodeToUpdateOriginal of nodeAndDescendants) {
        // 元のノードは書き換えるべきではない。Gatsby はメモリ上の弱参照キャッシュにあるものと
        // 比較するためである。そこで元のノードをクローンし、
        // 参照が同一にならないようにする
        const nodeToUpdate = nodeToUpdateOriginal.__memcache
          ? getNode(nodeToUpdateOriginal.id)
          : nodeToUpdateOriginal

        let counter
        const [initialContentDigest, counterStr] =
          nodeToUpdate.internal.contentDigest.split(
            CONTENT_DIGEST_COUNTER_SEPARATOR
          )

        if (counterStr) {
          counter = parseInt(counterStr, 10)
        }

        if (!counter || isNaN(counter)) {
          counter = 1
        } else {
          counter++
        }

        const newNode = {
          ...nodeToUpdate,
          internal: {
            ...nodeToUpdate.internal,
            // 既存のフィールドから、Gatsby が予約して管理しているプロパティ
            // （`.internal.owner`、`.fields`）を取り除く必要がある。
            // `.owner` は Gatsby が自動的に設定し直す
            owner: undefined,
            // contentDigest にカウンターの接尾辞を追加または変更し、
            // Gatsby がこれをデータの更新として扱うようにする
            contentDigest: `${initialContentDigest}${CONTENT_DIGEST_COUNTER_SEPARATOR}${counter}`,
          },
          // `.fields` は `createNodeField` アクションで作成する必要があり、単に追加し直すことはできない。
          // ほかのプラグイン（またはサイト自身）は `onCreateNode` ライフサイクルで再生成できる。
          // Contentful のコンテンツノードは `createNodeField` を使っていないので、削除しても安全である。
          // （アセットノードは `localFile` のために `createNodeField` を使っている。もしそれらを更新するなら、
          // ノードを作り直した後に、そのフィールドもこちらで復元する必要がある）
          fields: undefined, // プラグインは、逆方向のリンクを持たないアセットノードにノードフィールドを追加する
        }

        // メモリにキャッシュしたノードはバックリファレンスの確認中に書き換えられるので、
        // その変更を更新後のノードへ引き継ぐ必要がある
        if (nodeToUpdateOriginal.__memcache) {
          for (const key of Object.keys(nodeToUpdateOriginal)) {
            if (!key.endsWith(`___NODE`)) {
              continue
            }

            newNode[key] = nodeToUpdateOriginal[key]
          }
        }

        createNode(newNode)

        if (existingNodesLoopCount++ % 2000 === 0) {
          // イベントループをブロックしない
          await untilNextEventLoopTick()
        }
      }
    }
  }

  // 必要であれば node が GC できるようにする
  // @ts-ignore
  existingNodesThatNeedReverseLinksUpdateInDatastore = undefined
  await untilNextEventLoopTick()

  const creationActivity = reporter.activityTimer(`Contentful: Create nodes`, {
    parentSpan,
  })
  creationActivity.start()

  for (let i = 0; i < contentTypeItems.length; i++) {
    const contentTypeItem = contentTypeItems[i]

    if (entryList[i].length) {
      reporter.info(
        `Creating ${entryList[i].length} Contentful ${
          pluginConfig.get(`useNameForId`)
            ? contentTypeItem.name
            : contentTypeItem.sys.id
        } nodes`
      )
    }

    // 1 つの contentType が、ノードを作成するエントリーを大量に持つことがある
    // すべてのノードが作成されて処理されるのを待ってから、次を処理する
    await createNodesForContentType({
      contentTypeItem,
      restrictedNodeFields,
      conflictFieldPrefix,
      entries: entryList[i],
      createNode,
      createNodeId,
      getNode,
      resolvable,
      foreignReferenceMap,
      defaultLocale,
      locales,
      space,
      useNameForId: pluginConfig.get(`useNameForId`),
      pluginConfig,
      unstable_createNodeManifest,
    })

    // 必要であれば node がこれらをガベージコレクションできるようにする
    contentTypeItems[i] = undefined
    entryList[i] = undefined
    await untilNextEventLoopTick()
  }

  if (assets.length) {
    reporter.info(`Creating ${assets.length} Contentful asset nodes`)
  }

  const assetNodes = []
  for (let i = 0; i < assets.length; i++) {
    // 各アセットの処理が終わるのを待ってから、次を処理する。
    assetNodes.push(
      ...(await createAssetNodes({
        assetItem: assets[i],
        createNode,
        createNodeId,
        defaultLocale,
        locales,
        space,
        pluginConfig,
      }))
    )

    assets[i] = undefined
    if (i % 1000 === 0) {
      await untilNextEventLoopTick()
    }
  }

  await untilNextEventLoopTick()

  // タグのエンティティを作成する
  if (tagItems.length) {
    reporter.info(`Creating ${tagItems.length} Contentful Tag nodes`)

    for (const tag of tagItems) {
      await createNode({
        id: createNodeId(`ContentfulTag__${space.sys.id}__${tag.sys.id}`),
        name: tag.name,
        contentful_id: tag.sys.id,
        internal: {
          type: `ContentfulTag`,
          contentDigest: tag.sys.updatedAt,
        },
      })
    }
  }

  creationActivity.end()

  // アセットファイルをローカルの fs へダウンロードする
  if (pluginConfig.get(`downloadLocal`)) {
    await downloadContentfulAssets({
      assetNodes,
      actions,
      createNodeId,
      store,
      cache,
      getCache,
      getNode,
      reporter,
      assetDownloadWorkers: pluginConfig.get(`assetDownloadWorkers`),
    })
  }
}
