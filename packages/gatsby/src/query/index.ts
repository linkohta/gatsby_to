import _ from "lodash"
import fastq from "fastq"
import { IProgressReporter } from "gatsby-cli/lib/reporter/reporter-progress"
import { store } from "../redux"
import { IGatsbyPage, IGatsbyState } from "../redux/types"
import { hasFlag, FLAG_ERROR_EXTRACTION } from "../redux/reducers/queries"
import { IQueryJob, queryRunner } from "./query-runner"
import {
  IStaticQueryResult,
  websocketManager,
} from "../utils/websocket-manager"
import { GraphQLRunner } from "./graphql-runner"
import { IGroupedQueryIds } from "../services"
import { createPageDependencyBatcher } from "../redux/actions/add-page-dependency"

if (process.env.GATSBY_EXPERIMENTAL_QUERY_CONCURRENCY) {
  console.info(
    `GATSBY_EXPERIMENTAL_QUERY_CONCURRENCY: Running with concurrency set to \`${process.env.GATSBY_EXPERIMENTAL_QUERY_CONCURRENCY}\``
  )
}

const concurrency =
  Number(process.env.GATSBY_EXPERIMENTAL_QUERY_CONCURRENCY) || 4

/**
 * ダーティなクエリ ID（page.path または staticQuery.id）の集合を計算する。
 *
 * ダーティな状態は `queries` レデューサーで追跡されている。ここでは、
 * 追跡されているすべてのクエリからそれらを絞り込むだけである。
 */
export function calcDirtyQueryIds(state: IGatsbyState): Array<string> {
  const { trackedQueries, trackedComponents, deletedQueries } = state.queries

  const queriesWithBabelErrors = new Set()
  for (const component of trackedComponents.values()) {
    if (hasFlag(component.errors, FLAG_ERROR_EXTRACTION)) {
      for (const queryId of component.pages) {
        queriesWithBabelErrors.add(queryId)
      }
    }
  }
  // 注: trackedQueries には、ページクエリと静的クエリの両方の ID が含まれる
  const dirtyQueryIds: Array<string> = []
  for (const [queryId, query] of trackedQueries) {
    if (deletedQueries.has(queryId)) {
      continue
    }
    if (query.dirty > 0 && !queriesWithBabelErrors.has(queryId)) {
      dirtyQueryIds.push(queryId)
    }
  }
  return dirtyQueryIds
}

export { calcDirtyQueryIds as calcInitialDirtyQueryIds }

/**
 * queryId を、静的クエリかページクエリかで分類する。
 */
export function groupQueryIds(queryIds: Array<string>): IGroupedQueryIds {
  const grouped = _.groupBy(queryIds, p => {
    if (p.startsWith(`sq--`)) {
      return `static`
    } else if (p.startsWith(`slice--`)) {
      return `slice`
    } else {
      return `page`
    }
  })

  const { pages } = store.getState()

  return {
    staticQueryIds: grouped?.static || [],
    pageQueryIds:
      grouped?.page
        ?.map(path => pages.get(path) as IGatsbyPage)
        ?.filter(Boolean) || [],
    sliceQueryIds: grouped?.slice || [],
  }
}

function createQueue<QueryIDType>({
  createJobFn,
  state,
  activity,
  graphqlRunner,
  graphqlTracing,
}: {
  createJobFn: (
    state: IGatsbyState,
    queryId: QueryIDType
  ) => IQueryJob | undefined
  state: IGatsbyState
  activity: IProgressReporter
  graphqlRunner: GraphQLRunner
  graphqlTracing: boolean
}): fastq.queue<QueryIDType, any> {
  if (!graphqlRunner) {
    graphqlRunner = new GraphQLRunner(store, { graphqlTracing })
  }
  state = state || store.getState()

  function worker(queryId: QueryIDType, cb): void {
    const job = createJobFn(state, queryId)
    if (!job) {
      setImmediate(() => cb(null, undefined))
      return
    }
    queryRunner(graphqlRunner, job, activity?.span)
      .then(result => {
        if (activity.tick) {
          activity.tick()
        }
        // 注: クエリの実行中にガベージコレクションが始まる機会を確保するために、
        //  setImmediate が必要である
        setImmediate(() => cb(null, { job, result }))
      })
      .catch(error => {
        cb(error)
      })
  }
  // 注: fastq.promise 版はかなり遅い
  return fastq(worker, concurrency)
}

async function processQueries<QueryIDType>({
  queryIds,
  createJobFn,
  onQueryDone,
  state,
  activity,
  graphqlRunner,
  graphqlTracing,
}: {
  queryIds: Array<QueryIDType>
  createJobFn: (
    state: IGatsbyState,
    queryId: QueryIDType
  ) => IQueryJob | undefined
  onQueryDone:
    (({ job, result }: { job: IQueryJob; result: unknown }) => void) | undefined
  state: IGatsbyState
  activity: IProgressReporter
  graphqlRunner: GraphQLRunner
  graphqlTracing: boolean
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const fastQueue = createQueue({
      createJobFn,
      state,
      activity,
      graphqlRunner,
      graphqlTracing,
    })

    queryIds.forEach((queryId: QueryIDType) => {
      fastQueue.push(queryId, (err, res) => {
        if (err) {
          fastQueue.kill()
          reject(err)
          return
        }
        if (res && onQueryDone) {
          onQueryDone(res)
        }
      })
    })

    if (!fastQueue.idle()) {
      fastQueue.drain = (): any => resolve()
    } else {
      resolve()
    }
  })
}

function createStaticQueryJob(
  state: IGatsbyState,
  queryId: string
): IQueryJob | undefined {
  const component = state.staticQueryComponents.get(queryId)

  if (!component) {
    return undefined
  }

  const { hash, id, query, componentPath } = component

  return {
    id: queryId,
    query,
    queryType: `static`,
    hash,
    componentPath,
    context: { path: id },
  }
}

function createSliceQueryJob(
  state: IGatsbyState,
  queryId: string
): IQueryJob | undefined {
  const sliceName = queryId.substring(7) // "slice--" プレフィックスを取り除く

  const sliceDef = state.slices.get(sliceName)
  if (!sliceDef) {
    return undefined
  }

  const component = state.components.get(sliceDef.componentPath)

  if (!component) {
    return undefined
  }

  const { componentPath, context } = sliceDef
  const { query } = component

  return {
    id: queryId,
    query,
    queryType: `slice`,
    componentPath,
    context: {
      path: queryId,
      ...context,
    },
  }
}

function onDevelopStaticQueryDone({
  job,
  result,
}: {
  job: IQueryJob
  result: IStaticQueryResult[`result`]
}): void {
  if (!job.hash) {
    return
  }

  websocketManager.emitStaticQueryData({
    result,
    id: job.hash,
  })
}

export async function processStaticQueries(
  queryIds: IGroupedQueryIds[`staticQueryIds`],
  { state, activity, graphqlRunner, graphqlTracing }
): Promise<void> {
  const processedQueries = await processQueries<string>({
    queryIds,
    createJobFn: createStaticQueryJob,
    onQueryDone:
      process.env.NODE_ENV === `production`
        ? undefined
        : onDevelopStaticQueryDone,
    state,
    activity,
    graphqlRunner,
    graphqlTracing,
  })

  // この時点でページの依存の取得は終わっているので、残りがある場合に備えて
  // バッチャーをフラッシュする必要がある
  createPageDependencyBatcher.flush()

  return processedQueries
}

export async function processSliceQueries(
  queryIds: IGroupedQueryIds[`sliceQueryIds`],
  { state, activity, graphqlRunner, graphqlTracing }
): Promise<void> {
  const processedQueries = await processQueries<string>({
    queryIds,
    createJobFn: createSliceQueryJob,
    onQueryDone: undefined, // これにも、後で静的クエリと同じ HMR の仕組みが必要になるかもしれない
    state,
    activity,
    graphqlRunner,
    graphqlTracing,
  })

  // この時点でページの依存の取得は終わっているので、残りがある場合に備えて
  // バッチャーをフラッシュする必要がある
  createPageDependencyBatcher.flush()

  return processedQueries
}

export async function processPageQueries(
  queryIds: IGroupedQueryIds[`pageQueryIds`],
  { state, activity, graphqlRunner, graphqlTracing }
): Promise<void> {
  const processedQueries = await processQueries<IGatsbyPage>({
    queryIds,
    createJobFn: createPageQueryJob,
    onQueryDone: undefined,
    state,
    activity,
    graphqlRunner,
    graphqlTracing,
  })

  // この時点でページの依存の取得は終わっているので、残りがある場合に備えて
  // バッチャーをフラッシュする必要がある
  createPageDependencyBatcher.flush()

  return processedQueries
}

function createPageQueryJob(
  state: IGatsbyState,
  page: IGatsbyPage
): IQueryJob | undefined {
  const component = state.components.get(page.componentPath)

  if (!component) {
    return undefined
  }

  const { path, componentPath, context } = page
  const { query } = component

  return {
    id: path,
    query,
    queryType: `page`,
    componentPath,
    context: {
      ...page,
      ...context,
    },
  }
}
