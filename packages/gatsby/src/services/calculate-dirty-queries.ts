import { calcDirtyQueryIds, groupQueryIds } from "../query"
import { IGroupedQueryIds } from "./"
import { IQueryRunningContext } from "../state-machines/query-running/types"
import { assertStore } from "../utils/assert-store"

export async function calculateDirtyQueries({
  store,
  websocketManager,
  currentlyHandledPendingQueryRuns,
}: Partial<IQueryRunningContext>): Promise<{
  queryIds: IGroupedQueryIds
}> {
  assertStore(store)
  const state = store.getState()
  const queryIds: Array<string> = calcDirtyQueryIds(state)

  let queriesToRun = queryIds

  if (
    process.env.gatsby_executing_command === `develop` &&
    process.env.GATSBY_QUERY_ON_DEMAND
  ) {
    // 404 はランタイムの中で特別なケースになっている。理想的には汎用の仕組みで
    // 動かしたいが、今のところは特別な処理をしている
    const pagePathFilter = new Set([`/404.html`, `/dev-404-page/`])

    // ユーザーが現在ブラウザーで見ているページのクエリを
    // 確実に実行したい
    if (websocketManager?.activePaths) {
      for (const activePath of websocketManager.activePaths) {
        pagePathFilter.add(activePath)
      }
    }

    // `page-data` の fetch や websocket のリクエストによって
    // 要求されたページも確実に含めたい
    if (currentlyHandledPendingQueryRuns) {
      for (const pendingQuery of currentlyHandledPendingQueryRuns) {
        pagePathFilter.add(pendingQuery)
      }
    }

    // 静的クエリとスライスのクエリもオンデマンドではない
    queriesToRun = queryIds.filter(
      queryId =>
        queryId.startsWith(`sq--`) ||
        queryId.startsWith(`slice--`) ||
        pagePathFilter.has(queryId)
    )
  }

  return {
    queryIds: groupQueryIds(queriesToRun),
  }
}
