import { CREATED_NODE_IDS, LAST_COMPLETED_SOURCE_TIME } from "~/constants"
import { fetchAndRunWpActions } from "./wp-actions"
import { formatLogMessage } from "~/utils/format-log-message"
import { getGatsbyApi } from "~/utils/get-gatsby-api"
import { getPersistentCache } from "~/utils/cache"
import { needToTouchNodes } from "../../../utils/gatsby-features"
import { withPluginKey } from "~/store"

export const touchValidNodes = async () => {
  if (!needToTouchNodes) {
    return
  }

  const { helpers } = getGatsbyApi()
  const { actions } = helpers

  const validNodeIds = await getPersistentCache({ key: CREATED_NODE_IDS })

  if (validNodeIds?.length) {
    validNodeIds.forEach(nodeId => actions.touchNode(helpers.getNode(nodeId)))
  }
}

/**
 * fetchAndApplyNodeUpdates
 *
 * onPreBootstrap で取得または生成したクエリ情報（型と gql のクエリ文字列）を使って
 * WordPress に最新の変更を問い合わせ、Gatsby のノードに
 * 作成、更新、削除を適用する
 */
const fetchAndApplyNodeUpdates = async ({
  since,
  throwFetchErrors = false,
  throwGqlErrors = false,
}) => {
  const { helpers, pluginOptions } = getGatsbyApi()

  const { cache, reporter } = helpers

  const activity = reporter.activityTimer(
    formatLogMessage(`pull updates since last build`)
  )
  activity.start()

  if (!since) {
    since = await cache.get(withPluginKey(LAST_COMPLETED_SOURCE_TIME))
  }

  // WPGQL に問い合わせて、キャッシュした WP のノードを作成、削除、更新する
  const { wpActions, didUpdate } = await fetchAndRunWpActions({
    since,
    helpers,
    pluginOptions,
    throwFetchErrors,
    throwGqlErrors,
  })

  await touchValidNodes()

  activity.end()

  return { wpActions, didUpdate }
}

export default fetchAndApplyNodeUpdates
