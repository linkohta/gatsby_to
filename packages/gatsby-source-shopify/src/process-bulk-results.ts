import { SourceNodesArgs } from "gatsby"

import { shopifyTypes } from "./shopify-types"
import {
  isShopifyId,
  createNodeId,
  parseShopifyId,
  decorateBulkObject,
  processShopifyImages,
} from "./helpers"

interface IDecoratedResultChildren {
  [key: string]: Array<string | IDecoratedResult>
}

function isNode(result: IDecoratedResult): boolean {
  const keys = Object.keys(result)
  return Boolean(
    result.shopifyId &&
    !(keys.length === 2 && result.__parentId && result.shopifyId)
  )
}

export async function processBulkResults(
  gatsbyApi: SourceNodesArgs,
  pluginOptions: IShopifyPluginOptions,
  results: BulkResults
): Promise<number> {
  let nodeCount = 0
  const promises: Array<Promise<void>> = []
  const children: IDecoratedResultChildren = {}

  const gatsbyCreateNodeId = (shopifyId: string): string =>
    createNodeId(shopifyId, gatsbyApi, pluginOptions)

  for (let i = results.length - 1; i >= 0; i -= 1) {
    const result = decorateBulkObject(
      results[i],
      gatsbyCreateNodeId
    ) as IDecoratedResult
    /**
     * @todo JSON.stringify の順序は決定的ではないので、次の違いを検出する
     */
    const resultIsNode = isNode(result)

    if (resultIsNode) {
      const type = parseShopifyId(result.shopifyId)[1]
      const imageFields = shopifyTypes[type].imageFields
      const referenceFields = shopifyTypes[type].referenceFields

      // 親ノードの場合だけ増やす
      if (!result.__parentId) nodeCount++

      // 参照フィールドを付ける
      if (referenceFields) {
        for (const referenceField of referenceFields) {
          result[referenceField] = []
        }
      }

      // 子の参照またはオブジェクトを付ける
      if (children[result.shopifyId]) {
        for (const child of children[result.shopifyId]) {
          const childType =
            typeof child === `string`
              ? parseShopifyId(child)[1]
              : (child.__typename as string)
          const field = shopifyTypes[childType].key

          if (field) {
            result[field] = [
              typeof child === `string`
                ? createNodeId(child, gatsbyApi, pluginOptions)
                : child,
              ...((result[field] || []) as Array<unknown>),
            ]
          } else {
            throw new Error(
              `There is no shopifyType for child type: ${childType}`
            )
          }
        }
      }

      if (!isShopifyId(result.shopifyId)) {
        throw new Error(
          `Expected an ID in the format gid://shopify/<typename>/<id>`
        )
      }

      const node = {
        ...result,
        id: createNodeId(result.shopifyId, gatsbyApi, pluginOptions),
        internal: {
          type: `${pluginOptions.typePrefix}Shopify${type}`,
          contentDigest: gatsbyApi.createContentDigest(result),
        },
      } as IShopifyNode

      if (pluginOptions.downloadImages && imageFields) {
        promises.push(
          processShopifyImages(gatsbyApi, node).then(() =>
            gatsbyApi.actions.createNode(node)
          )
        )
      } else {
        gatsbyApi.actions.createNode(node)
      }
    }

    // オブジェクトが子であれば、参照を保存する
    if (result.__parentId) {
      children[result.__parentId] = [
        ...(children[result.__parentId] || []),
        result.shopifyId || result,
      ]
    }
  }

  await Promise.all(promises)
  return nodeCount
}
