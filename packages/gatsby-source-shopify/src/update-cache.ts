import { SourceNodesArgs } from "gatsby"

import { eventsApi } from "./events"
import { shopifyTypes } from "./shopify-types"
import { createNodeId, parseShopifyId } from "./helpers"

const deletionCounter: { [key: string]: number } = {}

/**
 * invalidateNode - 無効化されるノード id の配列を返す再帰関数
 * @param gatsbyApi - Gatsby のヘルパー
 * @param pluginOptions - プラグインオプションのオブジェクト
 * @param id - 無効化するルートノード
 *
 * Note: この関数は、最初はトップレベルのノードを 1 つ受け取り、
 * その後は結び付いたノードの階層ごとに自分自身を再帰的に呼び出すように設計されている
 */
function invalidateNode(
  gatsbyApi: SourceNodesArgs,
  pluginOptions: IShopifyPluginOptions,
  id: string,
  invalidatedNodeIds = new Set<string>()
): Set<string> {
  const { typePrefix } = pluginOptions

  const node = gatsbyApi.getNode(id)

  if (node) {
    invalidatedNodeIds.add(node.id)
    const type = node.internal.type.replace(`${typePrefix}Shopify`, ``)
    const { coupledNodeFields } = shopifyTypes[type]

    if (coupledNodeFields) {
      for (const field of coupledNodeFields) {
        for (const coupledNodeId of node[field] as Array<string>) {
          invalidateNode(
            gatsbyApi,
            pluginOptions,
            coupledNodeId,
            invalidatedNodeIds
          )
        }
      }
    }
  }

  return invalidatedNodeIds
}

function reportNodeDeletion(
  gatsbyApi: SourceNodesArgs,
  node: IShopifyNode
): void {
  const type = parseShopifyId(node.shopifyId)[1]
  deletionCounter[type] = (deletionCounter[type] || 0) + 1

  const identifier = node.shopifyId
    ? `shopify ID: ${node.shopifyId}`
    : `internal ID: ${node.id}`

  gatsbyApi.reporter.info(`Deleting ${type} node with ${identifier}`)
}

function reportDeletionSummary(gatsbyApi: SourceNodesArgs): void {
  gatsbyApi.reporter.info(`===== SHOPIFY NODE DELETION SUMMARY =====`)

  for (const [key, value] of Object.entries(deletionCounter)) {
    gatsbyApi.reporter.info(`${key}: ${value}`)
  }
}

export async function updateCache(
  gatsbyApi: SourceNodesArgs,
  pluginOptions: IShopifyPluginOptions,
  lastBuildTime: Date
): Promise<void> {
  const { fetchDestroyEventsSince } = eventsApi(pluginOptions)
  const destroyEvents = await fetchDestroyEventsSince(lastBuildTime)

  const invalidatedNodeIds = new Set<string>()
  for (const value of destroyEvents) {
    const shopifyId = `gid://shopify/${value.subject_type}/${value.subject_id}`
    const nodeId = createNodeId(shopifyId, gatsbyApi, pluginOptions)
    invalidateNode(gatsbyApi, pluginOptions, nodeId, invalidatedNodeIds)
  }

  // イベントループを長時間ブロックしない
  await new Promise(resolve => setImmediate(resolve))

  for (const shopifyType of Object.keys(shopifyTypes)) {
    {
      // 次の反復の前に（必要であれば）Node が `nodes` を GC できるよう、クロージャにしている
      const nodes = gatsbyApi.getNodesByType(
        `${pluginOptions.typePrefix}Shopify${shopifyType}`
      ) as Array<IShopifyNode>

      for (const node of nodes) {
        if (invalidatedNodeIds.has(node.id)) {
          gatsbyApi.actions.deleteNode(node)
          reportNodeDeletion(gatsbyApi, node)
        } else {
          gatsbyApi.actions.touchNode(node)
        }
      }
    }

    // イベントループを長時間ブロックしない
    await new Promise(resolve => setImmediate(resolve))
  }

  if (invalidatedNodeIds.size > 0) {
    reportDeletionSummary(gatsbyApi)
  }
}
