import { Span } from "opentracing"
import _ from "lodash"
import fs from "fs-extra"
import report from "gatsby-cli/lib/reporter"
import { ExecutionResult, GraphQLError } from "graphql"
import { sha1 } from "gatsby-core-utils/hash"

import path from "path"
import { store } from "../redux"
import { actions } from "../redux/actions"
import { getCodeFrame } from "./graphql-errors-codeframe"
import errorParser from "./error-parser"

import { GraphQLRunner } from "./graphql-runner"
import { IExecutionResult, PageContext } from "./types"
import { pageDataExists, savePageQueryResult } from "../utils/page-data"
import GatsbyCacheLmdb from "../utils/cache-lmdb"

let resultHashCache: GatsbyCacheLmdb | undefined
function getResultHashCache(): GatsbyCacheLmdb {
  if (!resultHashCache) {
    resultHashCache = new GatsbyCacheLmdb({
      name: `query-result-hashes`,
      encoding: `string`,
    }).init()
  }
  return resultHashCache
}

export interface IQueryJob {
  id: string
  hash?: string
  query: string
  componentPath: string
  context: PageContext
  queryType: `page` | `static` | `slice`
  pluginCreatorId?: string
}

function reportLongRunningQueryJob(queryJob: IQueryJob): void {
  const messageParts = [
    `This query took more than 15s to run — which might indicate you're querying too much or have some unoptimized code:`,
    `File path: ${queryJob.componentPath}`,
  ]

  if (queryJob.queryType === `page`) {
    messageParts.push(`URL path: ${queryJob.context.path}`)
  }

  report.warn(messageParts.join(`\n`))
}

function panicQueryJobError(
  queryJob: IQueryJob,
  errors: ReadonlyArray<GraphQLError>
): void {
  let urlPath = undefined
  let queryContext = {}
  const plugin = queryJob.pluginCreatorId || `none`

  if (queryJob.queryType === `page`) {
    urlPath = queryJob.context.path
    queryContext = queryJob.context.context
  }

  const structuredErrors = errors.map(e => {
    const structuredError = errorParser({
      message: e.message,
      filePath: undefined,
      location: undefined,
      error: e,
    })

    structuredError.context = {
      ...structuredError.context,
      codeFrame: getCodeFrame(
        queryJob.query,
        e.locations && e.locations[0].line,
        e.locations && e.locations[0].column
      ),
      filePath: queryJob.componentPath,
      ...(urlPath ? { urlPath } : {}),
      ...queryContext,
      plugin,
    }

    return structuredError
  })

  report.panicOnBuild(structuredErrors)
}

async function startQueryJob(
  graphqlRunner: GraphQLRunner,
  queryJob: IQueryJob,
  parentSpan: Span | undefined
): Promise<ExecutionResult> {
  let isPending = true

  // クエリに時間がかかりすぎている場合は警告を出力する
  const timeoutId = setTimeout(() => {
    if (isPending) {
      reportLongRunningQueryJob(queryJob)
    }
  }, 15000)

  return graphqlRunner
    .query(queryJob.query, queryJob.context, {
      parentSpan,
      queryName: queryJob.id,
      componentPath: queryJob.componentPath,
    })
    .finally(() => {
      isPending = false
      clearTimeout(timeoutId)
    })
}

export async function queryRunner(
  graphqlRunner: GraphQLRunner,
  queryJob: IQueryJob,
  parentSpan: Span | undefined
): Promise<IExecutionResult> {
  const { program } = store.getState()

  store.dispatch(
    actions.queryStart({
      path: queryJob.id,
      componentPath: queryJob.componentPath,
      isPage: queryJob.queryType === `page`,
    })
  )

  // クエリを実行する
  let result: IExecutionResult
  // クエリが存在しなければ何もしない。
  if (!queryJob.query || queryJob.query === ``) {
    result = {}
  } else {
    result = await startQueryJob(graphqlRunner, queryJob, parentSpan)
  }

  if (result.errors) {
    // graphql のエラーがある場合は、エラーをログに出して終了する
    panicQueryJobError(queryJob, result.errors)
  }

  // ページやスライスのコンテキストを結果に追加する。
  if (queryJob) {
    if (queryJob.queryType === `page`) {
      result[`pageContext`] = Object.assign({}, queryJob.context)
    } else if (queryJob.queryType === `slice`) {
      result[`sliceContext`] = Object.assign({}, queryJob.context)
    }
  }

  // pageContext から内部データを削除する
  if (result.pageContext) {
    delete result.pageContext.path
    delete result.pageContext.internalComponentName
    delete result.pageContext.component
    delete result.pageContext.componentChunkName
    delete result.pageContext.updatedAt
    delete result.pageContext.pluginCreator___NODE
    delete result.pageContext.pluginCreatorId
    delete result.pageContext.componentPath
    delete result.pageContext.context
    delete result.pageContext.isCreatedByStatefulCreatePages
    delete result.pageContext.matchPath
    delete result.pageContext.mode
    delete result.pageContext.slices
  }

  const resultJSON = JSON.stringify(result)
  const resultHash = await sha1(resultJSON)

  const resultHashCache = getResultHashCache()

  let resultHashCacheKey = queryJob.id
  if (queryJob.queryType === `static`) {
    // 静的クエリでは、結果を出力するファイルのパスにハッシュを使う。
    // sort と aggregation を自動で書き換える graphql の codemod によって、結果は同じでも
    // クエリテキストのハッシュが異なることがある。そのため、クエリのハッシュも確認しないと、
    // ディスクへのファイルの書き出しがスキップされてしまう
    resultHashCacheKey += `-${queryJob.hash}`
  }

  if (
    resultHash !== (await resultHashCache.get(resultHashCacheKey)) ||
    (queryJob.queryType === `page` &&
      !pageDataExists(path.join(program.directory, `public`), queryJob.id))
  ) {
    await resultHashCache.set(resultHashCacheKey, resultHash)

    if (queryJob.queryType === `page` || queryJob.queryType === `slice`) {
      // この時点ではまだ不完全かもしれないので、
      // 一時的にキャッシュに保存しておく必要がある
      await savePageQueryResult(queryJob.id, resultJSON)
      if (queryJob.queryType === `page`) {
        store.dispatch({
          type: `ADD_PENDING_PAGE_DATA_WRITE`,
          payload: {
            path: queryJob.id,
          },
        })
      } else if (queryJob.queryType === `slice`) {
        store.dispatch({
          type: `ADD_PENDING_SLICE_DATA_WRITE`,
          payload: {
            name: queryJob.id.substring(7), // "slice--" プレフィックスを取り除く
          },
        })
      }
    } else if (queryJob.queryType === `static`) {
      const resultPath = path.join(
        program.directory,
        `public`,
        `page-data`,
        `sq`,
        `d`,
        `${queryJob.hash}.json`
      )
      await fs.outputFile(resultPath, resultJSON)
    }
  }

  // ページのクエリが実行されたことを通知する。
  store.dispatch(
    actions.pageQueryRun({
      path: queryJob.id,
      componentPath: queryJob.componentPath,
      queryType: queryJob.queryType,
      resultHash,
      queryHash: queryJob.hash,
    })
  )

  return result
}
