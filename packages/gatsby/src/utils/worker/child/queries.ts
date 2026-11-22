import {
  IGroupedQueryIds,
  runPageQueries,
  runStaticQueries,
} from "../../../services"
import { savePartialStateToDisk, store } from "../../../redux"
import { GraphQLRunner } from "../../../query/graphql-runner"
import { getDataStore } from "../../../datastore"
import { setState } from "./state"
import { buildSchema } from "./schema"
import {
  IAddPendingPageDataWriteAction,
  ICreatePageDependencyAction,
  IGatsbyState,
  IPageQueryRunAction,
  IQueryStartAction,
} from "../../../redux/types"
import { DeepPartial } from "redux"
import { waitUntilPageQueryResultsAreStored } from "../../page-data"

export function setComponents(): void {
  setState([`components`, `staticQueryComponents`])
}

export async function saveQueriesDependencies(): Promise<void> {
  // クエリの状態から `queryNodes` を取り除く。これは状態のほかの部分から復元でき、
  // パフォーマンスの最適化のためだけに存在する
  const pickNecessaryQueryState = <T extends DeepPartial<IGatsbyState>>(
    state: T
  ): T => {
    if (!state?.queries?.queryNodes) return state
    return { ...state, queries: { ...state.queries, queryNodes: new Map() } }
  }
  savePartialStateToDisk(
    [`queries`, `telemetry`],
    process.env.GATSBY_WORKER_ID,
    pickNecessaryQueryState
  )

  // lmdb-store に入れたページクエリの結果が確実にフラッシュされるようにする
  await waitUntilPageQueryResultsAreStored()
}

let gqlRunner

function getGraphqlRunner(): GraphQLRunner {
  if (!gqlRunner) {
    gqlRunner = new GraphQLRunner(store, {
      collectStats: true,
      graphqlTracing: store.getState().program.graphqlTracing,
    })
  }
  return gqlRunner
}

type ActionsToReplay = Array<
  | IQueryStartAction
  | IPageQueryRunAction
  | IAddPendingPageDataWriteAction
  | ICreatePageDependencyAction
>

export async function runQueries(
  queryIds: IGroupedQueryIds
): Promise<ActionsToReplay> {
  const actionsToReplay: ActionsToReplay = []

  const unsubscribe = store.subscribe(() => {
    const action = store.getState().lastAction
    if (
      action.type === `QUERY_START` ||
      action.type === `PAGE_QUERY_RUN` ||
      action.type === `ADD_PENDING_PAGE_DATA_WRITE`
      // Note: `CREATE_COMPONENT_DEPENDENCY` アクションを保存して再生する代わりに、
      // クエリの実行が終わった時点で一度だけ状態をマージする（このアクションの再生はコストが高い）
    ) {
      actionsToReplay.push(action)
    }
  })

  try {
    await doRunQueries(queryIds)
    return actionsToReplay
  } finally {
    unsubscribe()
  }
}

async function doRunQueries(queryIds: IGroupedQueryIds): Promise<void> {
  const workerStore = store.getState()

  // buildSchema() がまだ実行されていなければ実行する
  if (workerStore.schemaCustomization.composer === null) {
    await buildSchema()
  }

  const graphqlRunner = getGraphqlRunner()

  await runStaticQueries({
    queryIds,
    store,
    graphqlRunner,
  })

  await runPageQueries({
    queryIds,
    store,
    graphqlRunner,
  })

  await getDataStore().ready()
}
