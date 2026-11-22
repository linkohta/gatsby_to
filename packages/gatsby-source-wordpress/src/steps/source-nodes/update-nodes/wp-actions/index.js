import { actionMonitorQuery } from "~/utils/graphql-queries"
import wpActionDELETE from "./delete"
import wpActionUPDATE from "./update"
import { LAST_COMPLETED_SOURCE_TIME } from "~/constants"
import { paginatedWpNodeFetch } from "~/steps/source-nodes/fetch-nodes/fetch-nodes-paginated"

import fetchAndCreateNonNodeRootFields from "~/steps/source-nodes/create-nodes/fetch-and-create-non-node-root-fields"
import { setHardCachedNodes } from "~/utils/cache"
import { sourceNodes } from "~/steps/source-nodes"
import { withPluginKey } from "~/store"

/**
 * getWpActions
 *
 * WP から最新の変更を取得し、そのうちどの変更が Gatsby 側の更新を
 * 必要とするかを判定して、有効な変更を返す
 * 有効でない変更の例は、作成された直後に
 * 削除された投稿である。
 */
export const getWpActions = async ({
  variables,
  helpers,
  throwFetchErrors = false,
  throwGqlErrors = false,
}) => {
  const sourceTime = Date.now()

  // @todo 前回のビルド以降のアクションが 100 件を超える場合に備え、ページネーションを追加する
  const actionMonitorActions = await paginatedWpNodeFetch({
    contentTypePlural: `actionMonitorActions`,
    query: actionMonitorQuery,
    nodeTypeName: `ActionMonitor`,
    helpers,
    throwFetchErrors,
    throwGqlErrors,
    ...variables,
  })

  if (!actionMonitorActions || !actionMonitorActions.length) {
    return []
  }

  await helpers.cache.set(withPluginKey(LAST_COMPLETED_SOURCE_TIME), sourceTime)

  return actionMonitorActions
}

/**
 * WordPress での変更に応じて、Gatsby を WP の最新の変更と
 * 同期させる関数を呼び出す
 */
export const handleWpActions = async api => {
  const { cachedNodeIds, helpers } = api

  switch (api.wpAction.actionType) {
    case `DELETE`:
      await wpActionDELETE(api)
      break
    case `UPDATE`:
    case `CREATE`:
      await wpActionUPDATE(api)
      break
    case `NON_NODE_ROOT_FIELDS`:
      await fetchAndCreateNonNodeRootFields()
      break
    case `REFETCH_ALL`:
      await sourceNodes({ ...helpers, refetchAll: true }, {})
  }

  await setHardCachedNodes({ helpers })

  return cachedNodeIds
}

/**
 * fetchAndRunWpActions
 *
 * WordPress の最新の変更の一覧を取得し、
 * その変更に応じて処理を行う
 */
export const fetchAndRunWpActions = async ({
  helpers,
  pluginOptions,
  since,
  throwFetchErrors = false,
  throwGqlErrors = false,
}) => {
  // WP の "Action Monitor" で、新規、編集、削除された投稿があるかを確認する
  const wpActions = await getWpActions({
    variables: {
      since,
    },
    helpers,
    throwFetchErrors,
    throwGqlErrors,
  })

  const didUpdate = !!wpActions.length

  if (didUpdate) {
    for (const wpAction of wpActions) {
      // ノードを作成、更新、削除する
      await handleWpActions({
        helpers,
        pluginOptions,
        wpAction,
      })
    }
  }

  return {
    wpActions,
    didUpdate,
  }
}
