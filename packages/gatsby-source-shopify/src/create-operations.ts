import { SourceNodesArgs } from "gatsby"

import { createGraphqlClient } from "./clients"
import { OperationError } from "./errors"

import { ProductsQuery } from "./query-builders/products-query"
import { ProductVariantsQuery } from "./query-builders/product-variants-query"
import { CollectionsQuery } from "./query-builders/collections-query"
import { OrdersQuery } from "./query-builders/orders-query"
import { LocationsQuery } from "./query-builders/locations-query"

import {
  OPERATION_STATUS_QUERY,
  OPERATION_BY_ID,
  CANCEL_OPERATION,
} from "./static-queries"

interface IOperations {
  productsOperation: IShopifyBulkOperation
  productVariantsOperation: IShopifyBulkOperation
  ordersOperation: IShopifyBulkOperation
  collectionsOperation: IShopifyBulkOperation
  locationsOperation: IShopifyBulkOperation
  cancelOperationInProgress: () => Promise<void>
  cancelOperation: (id: string) => Promise<IBulkOperationCancelResponse>
  finishLastOperation: () => Promise<void>
  completedOperation: (
    operationId: string,
    interval?: number
  ) => Promise<{ node: IBulkOperationNode }>
}

const finishedStatuses = [`COMPLETED`, `FAILED`, `CANCELED`, `EXPIRED`]
const failedStatuses = [`FAILED`, `CANCELED`]

export function createOperationObject(
  graphqlClient: IGraphQLClient,
  operationQuery: string,
  name: string
): IShopifyBulkOperation {
  return {
    execute: (): Promise<IBulkOperationRunQueryResponse> =>
      graphqlClient.request<IBulkOperationRunQueryResponse>(operationQuery),
    name,
  }
}

export function createOperations(
  gatsbyApi: SourceNodesArgs,
  pluginOptions: IShopifyPluginOptions,
  lastBuildTime?: Date
): IOperations {
  const graphqlClient = createGraphqlClient(pluginOptions)

  function currentOperation(): Promise<ICurrentBulkOperationResponse> {
    return graphqlClient.request(OPERATION_STATUS_QUERY)
  }

  async function finishLastOperation(): Promise<void> {
    const queryStartTime = Date.now()
    let lastWarningTime = queryStartTime
    const baseWarningInterval = 60 * 1000
    let warningInterval = baseWarningInterval
    let warningCount = 0

    let { currentBulkOperation } = await currentOperation()
    if (currentBulkOperation && currentBulkOperation.id) {
      if (!finishedStatuses.includes(currentBulkOperation.status)) {
        const timer = gatsbyApi.reporter.activityTimer(
          `Waiting for operation ${currentBulkOperation.id} : ${currentBulkOperation.status}`
        )
        timer.start()

        while (!finishedStatuses.includes(currentBulkOperation.status)) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          currentBulkOperation = (await currentOperation()).currentBulkOperation

          // CI 環境向けの警告を追加する
          if (
            process.env.CI &&
            Date.now() > lastWarningTime + warningInterval
          ) {
            lastWarningTime = Date.now()
            const runtime = Math.floor(
              (lastWarningTime - queryStartTime) / 1000
            )
            gatsbyApi.reporter.warn(
              `Operation ${currentBulkOperation.id} is still running after ${runtime} seconds with status "${currentBulkOperation.status}"`
            )

            // 次の間隔を処理する。毎分大量に送らないよう、時間を少しずつ延ばす
            warningCount += 1
            warningInterval =
              warningCount <= 5
                ? baseWarningInterval
                : baseWarningInterval * 2 * (warningCount - 5)
          }

          timer.setStatus(
            `Polling operation ${currentBulkOperation.id} : ${currentBulkOperation.status}`
          )
        }

        timer.end()
      }
    }
  }

  async function cancelOperation(
    id: string
  ): Promise<IBulkOperationCancelResponse> {
    return graphqlClient.request<IBulkOperationCancelResponse>(
      CANCEL_OPERATION,
      {
        id,
      }
    )
  }

  async function cancelOperationInProgress(): Promise<void> {
    let { currentBulkOperation: bulkOperation } = await currentOperation()

    if (!bulkOperation || finishedStatuses.includes(bulkOperation.status)) {
      return
    }

    const cancelTimer = gatsbyApi.reporter.activityTimer(
      `Cancelling previous operation: ${bulkOperation.id}`
    )

    cancelTimer.start()

    if (bulkOperation.status === `RUNNING`) {
      const { bulkOperationCancel } = await cancelOperation(bulkOperation.id)

      bulkOperation = bulkOperationCancel.bulkOperation

      while (bulkOperation.status !== `CANCELED`) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const currentOp = await currentOperation()
        bulkOperation = currentOp.currentBulkOperation
        cancelTimer.setStatus(
          `Waiting for operation to cancel: ${bulkOperation.id}`
        )
      }
      cancelTimer.setStatus(`Cancelled operation: ${bulkOperation.id}`)
    } else {
      /**
       * 実行中でないからといって、完了しているとは限らない。たとえば
       * CANCELING の可能性がある。新しいものを始める前に、正式に終了するのを
       * 待つ必要がある。
       */
      while (!finishedStatuses.includes(bulkOperation.status)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        bulkOperation = (await currentOperation()).currentBulkOperation
        cancelTimer.setStatus(
          `Waiting for operation to complete: ${bulkOperation.id}`
        )
      }
      cancelTimer.setStatus(`Completed operation: ${bulkOperation.id}`)
    }

    cancelTimer.end()
  }

  /* 間隔は調整できるようにすべきかもしれない。データセットが
   * 大きいユーザーは、もっと長く待つことも十分にあり得る。返された
   * オブジェクト数と反復回数から、使っている間隔が短すぎることを
   * 検出し、間隔を延ばすよう勧めるフィードバックをユーザーに
   * 示すこともできるだろう。
   */
  async function completedOperation(
    operationId: string,
    interval = 1000
  ): Promise<{ node: IBulkOperationNode }> {
    let operation = await graphqlClient.request<{
      node: IBulkOperationNode
    }>(OPERATION_BY_ID, {
      id: operationId,
    })

    let waitForOperation = true

    while (waitForOperation) {
      if (failedStatuses.includes(operation.node.status)) {
        waitForOperation = false
        throw new OperationError(operation.node)
      }

      if (operation.node.status === `COMPLETED`) {
        waitForOperation = false
        return operation
      }

      await new Promise(resolve => setTimeout(resolve, interval))

      operation = await graphqlClient.request<{
        node: IBulkOperationNode
      }>(OPERATION_BY_ID, {
        id: operationId,
      })
    }

    throw new Error(`It should never reach this error`)
  }

  return {
    productsOperation: exports.createOperationObject(
      graphqlClient,
      new ProductsQuery(pluginOptions).query(lastBuildTime),
      `products`
    ),

    productVariantsOperation: exports.createOperationObject(
      graphqlClient,
      new ProductVariantsQuery(pluginOptions).query(lastBuildTime),
      `variants`
    ),

    ordersOperation: exports.createOperationObject(
      graphqlClient,
      new OrdersQuery(pluginOptions).query(lastBuildTime),
      `orders`
    ),

    collectionsOperation: exports.createOperationObject(
      graphqlClient,
      new CollectionsQuery(pluginOptions).query(lastBuildTime),
      `collections`
    ),

    locationsOperation: exports.createOperationObject(
      graphqlClient,
      new LocationsQuery(pluginOptions).query(lastBuildTime),
      `locations`
    ),

    cancelOperationInProgress,
    cancelOperation,
    finishLastOperation,
    completedOperation,
  }
}
