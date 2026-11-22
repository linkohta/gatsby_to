// @ts-check
import { createRemoteFileNode } from "gatsby-source-filesystem"
import { createUrl } from "./image-helpers"

/**
 * @name distributeWorkload
 * @param workers 完了させる非同期関数の一覧
 * @param {number} count 使用するタスクランナーの数（設定の assetDownloadWorkers を参照）
 */

async function distributeWorkload(workers, count = 50) {
  const methods = workers.slice()

  async function task() {
    while (methods.length > 0) {
      await methods.pop()()
    }
  }

  await Promise.all(new Array(count).fill(undefined).map(() => task()))
}

/**
 * @name downloadContentfulAssets
 * @description Contentful のアセットをローカルのファイルシステムへダウンロードする。
 * アセットファイルはダウンロードされ、キャッシュされる。リンクするには `localFile` を使う
 * @param gatsbyFunctions - Gatsby の内部ヘルパー関数
 */

export async function downloadContentfulAssets(gatsbyFunctions) {
  const {
    actions: { createNode, touchNode, createNodeField },
    createNodeId,
    store,
    cache,
    reporter,
    assetDownloadWorkers,
    getNode,
    assetNodes,
  } = gatsbyFunctions

  // `localFile` でアセットをリンクしているかどうかにかかわらず、ContentfulAsset ノードは
  // すべてダウンロードされ、キャッシュされ、public/static へコピーされる。

  const bar = reporter.createProgress(
    `Downloading Contentful Assets`,
    assetNodes.length
  )
  bar.start()
  await distributeWorkload(
    assetNodes.map(node => async () => {
      let fileNodeID
      const { contentful_id: id, node_locale: locale } = node
      const remoteDataCacheKey = `contentful-asset-${id}-${locale}`
      const cacheRemoteData = await cache.get(remoteDataCacheKey)
      if (!node.file) {
        reporter.log(id, locale)
        reporter.warn(`The asset with id: ${id}, contains no file.`)
        return Promise.resolve()
      }
      if (!node.file.url) {
        reporter.warn(
          `The asset with id: ${id} has a file but the file contains no url.`
        )
        return Promise.resolve()
      }
      const url = createUrl(node.file.url)

      // キャッシュ済みであれば、アセットを再びダウンロードしない
      // Note: Contentful のアセットは、変更されたアセットとキャッシュ済みのものを
      // 比較するのに役立つメタデータを提供していないのではないか
      if (cacheRemoteData) {
        fileNodeID = cacheRemoteData.fileNodeID // eslint-disable-line prefer-destructuring
        touchNode(getNode(cacheRemoteData.fileNodeID))
      }

      // キャッシュしたデータがなければ、ファイルをダウンロードする
      if (!fileNodeID) {
        const fileNode = await createRemoteFileNode({
          url,
          cache,
          createNode,
          createNodeId,
        })

        if (fileNode) {
          bar.tick()
          fileNodeID = fileNode.id

          await cache.set(remoteDataCacheKey, { fileNodeID })
        }
      }

      if (fileNodeID) {
        createNodeField({ node, name: `localFile`, value: fileNodeID })
      }

      return node
    }),
    assetDownloadWorkers
  )
}
