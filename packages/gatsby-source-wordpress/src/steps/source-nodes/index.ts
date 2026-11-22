import { Step } from "./../../utils/run-steps"
import fetchAndApplyNodeUpdates from "./update-nodes/fetch-node-updates"

import { fetchAndCreateAllNodes } from "./fetch-nodes/fetch-nodes"

import { LAST_COMPLETED_SOURCE_TIME } from "~/constants"
import { getStore, withPluginKey } from "~/store"
import fetchAndCreateNonNodeRootFields from "./create-nodes/fetch-and-create-non-node-root-fields"
import { allowFileDownloaderProgressBarToClear } from "./create-nodes/create-remote-file-node/progress-bar-promise"
import { sourcePreviews } from "~/steps/preview"
import { hasStatefulSourceNodes } from "~/utils/gatsby-features"

const sourceNodes: Step = async (helpers, pluginOptions) => {
  const { cache, webhookBody, refetchAll, actions } = helpers
  const typePrefix = pluginOptions.schema?.typePrefix ?? ``

  if (hasStatefulSourceNodes) {
    actions.enableStatefulSourceNodes()
  }

  // settings など、ノードではないルートフィールドを取得する。
  // 今のところ、ビルドのたびに取得し直している
  const nonNodeRootFieldsPromise = fetchAndCreateNonNodeRootFields()

  // プレビューの場合は、それを処理して早期に return する
  if (webhookBody.token && webhookBody.userDatabaseId) {
    await sourcePreviews(helpers)
    await nonNodeRootFieldsPromise
    return
  }

  const now = Date.now()

  const prefixedSourceTimeKey = withPluginKey(LAST_COMPLETED_SOURCE_TIME)

  const lastCompletedSourceTime =
    webhookBody.refreshing && webhookBody.since
      ? webhookBody.since
      : await cache.get(prefixedSourceTimeKey)

  const { schemaWasChanged } = getStore().getState().remoteSchema

  const fetchEverything =
    !lastCompletedSourceTime ||
    refetchAll ||
    // 開発時はすべてを取得し直さない
    (process.env.NODE_ENV !== `development` &&
      // かつ、スキーマが変更された場合
      schemaWasChanged)

  // キャッシュのないビルドの場合、
  // または、すべてを取得してキャッシュする最初のビルドが完了しなかった場合は、
  // WPGQL からすべてを取得する
  if (fetchEverything) {
    await fetchAndCreateAllNodes()
  }

  // WPGraphQL からすでにすべてを取得できている場合は、
  // 最新の変更だけを取得する
  else if (!fetchEverything) {
    await fetchAndApplyNodeUpdates({
      since: lastCompletedSourceTime,
    })
  }

  await nonNodeRootFieldsPromise

  allowFileDownloaderProgressBarToClear()
  await helpers.cache.set(prefixedSourceTimeKey, now)

  const { dispatch } = getStore()
  dispatch.remoteSchema.setSchemaWasChanged(false)
  dispatch.develop.resumeRefreshPolling()
}

export { sourceNodes }
