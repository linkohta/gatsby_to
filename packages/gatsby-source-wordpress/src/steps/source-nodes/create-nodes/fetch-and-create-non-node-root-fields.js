import { getStore } from "~/store"
import fetchGraphql from "~/utils/fetch-graphql"
import { formatLogMessage } from "~/utils/format-log-message"
import { createNodeWithSideEffects } from "./create-nodes"
import fetchReferencedMediaItemsAndCreateNodes from "../fetch-nodes/fetch-referenced-media-items"
import { CREATED_NODE_IDS } from "~/constants"
import { getPersistentCache, setPersistentCache } from "~/utils/cache"
import { needToTouchNodes } from "../../../utils/gatsby-features"

const fetchAndCreateNonNodeRootFields = async () => {
  const state = getStore().getState()

  const {
    remoteSchema: { nonNodeQuery },
    gatsbyApi: { helpers, pluginOptions },
  } = state

  const { reporter } = helpers

  const activity = reporter.activityTimer(formatLogMessage(`fetch root fields`))

  activity.start()

  const { data } = await fetchGraphql({
    query: nonNodeQuery,
    errorContext: `Error occurred while fetching non-Node root fields.`,
  })

  const createdNodeIds = []
  // const totalSideEffectNodes = []
  const referencedMediaItemNodeIds = new Set()

  const type = pluginOptions.schema.typePrefix

  const node = {
    ...data,
    id: `${pluginOptions.url}--rootfields`,
    type,
  }

  const createRootNode = createNodeWithSideEffects({
    node,
    state,
    referencedMediaItemNodeIds,
    createdNodeIds,
    type,
    // totalSideEffectNodes,
  })

  createRootNode()

  const referencedMediaItemNodeIdsArray = [...referencedMediaItemNodeIds]

  const newMediaItemIds = referencedMediaItemNodeIdsArray.filter(
    id => !helpers.getNode(id)
  )

  /**
   * メディアアイテムを遅延取得していない場合は、ここで先に
   * 取得する必要がある
   */
  if (!pluginOptions.type.MediaItem.lazyNodes && newMediaItemIds.length) {
    getStore().dispatch.logger.createActivityTimer({
      typeName: `MediaItems`,
      pluginOptions,
      reporter,
    })

    await fetchReferencedMediaItemsAndCreateNodes({
      referencedMediaItemNodeIds: newMediaItemIds,
    })

    if (needToTouchNodes) {
      const previouslyCachedNodeIds = await getPersistentCache({
        key: CREATED_NODE_IDS,
      })

      const createdNodeIds = [
        ...new Set([
          ...(previouslyCachedNodeIds || []),
          ...referencedMediaItemNodeIdsArray,
        ]),
      ]

      // 次回のビルドで touch できるよう、ノードの id を保存する
      // こうすれば、すべてのノードを取得し直さずに済む
      await setPersistentCache({ key: CREATED_NODE_IDS, value: createdNodeIds })
    }

    getStore().dispatch.logger.stopActivityTimer({
      typeName: `MediaItems`,
    })
  }

  activity.end()
}

export default fetchAndCreateNonNodeRootFields
