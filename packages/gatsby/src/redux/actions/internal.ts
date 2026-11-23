import reporter from "gatsby-cli/lib/reporter"

import {
  IGatsbyConfig,
  IGatsbyPlugin,
  ProgramStatus,
  ICreatePageDependencyAction,
  IDeleteComponentDependenciesAction,
  IReplaceComponentQueryAction,
  IReplaceStaticQueryAction,
  IQueryExtractedAction,
  IQueryExtractionGraphQLErrorAction,
  IQueryExtractedBabelSuccessAction,
  IQueryExtractionBabelErrorAction,
  ISetProgramStatusAction,
  IPageQueryRunAction,
  IRemoveStaleJobAction,
  ISetSiteConfig,
  ISetSiteFunctions,
  IGatsbyState,
  IDefinitionMeta,
  ISetGraphQLDefinitionsAction,
  IQueryStartAction,
  IApiFinishedAction,
  IQueryClearDirtyQueriesListToEmitViaWebsocket,
  ICreateJobV2FromInternalAction,
  ICreatePageDependencyActionPayloadType,
  IDeleteNodeManifests,
  IClearGatsbyImageSourceUrlAction,
} from "../types"

import { gatsbyConfigSchema } from "../../joi-schemas/joi"
import { didYouMean } from "../../utils/did-you-mean"
import {
  enqueueJob,
  InternalJob,
  removeInProgressJob,
  getInProcessJobPromise,
} from "../../utils/jobs/manager"
import { getEngineContext } from "../../utils/engine-context"

/**
 * ページとデータの間の依存を作成する。おそらく
 * 内部専用。
 * @private
 */
export const createPageDependencies = (
  payload: Array<ICreatePageDependencyActionPayloadType>,
  plugin = ``
): ICreatePageDependencyAction => {
  return {
    type: `CREATE_COMPONENT_DEPENDENCY`,
    plugin,
    payload: payload.map(({ path, nodeId, connection }) => {
      return {
        path,
        nodeId,
        connection,
      }
    }),
  }
}

/**
 * ページとデータの間の依存を作成する。おそらく
 * 内部専用。
 *
 * createPageDependencies の短縮形。
 * @private
 */
export const createPageDependency = (
  payload: ICreatePageDependencyActionPayloadType,
  plugin = ``
): ICreatePageDependencyAction => createPageDependencies([payload], plugin)

/**
 * ページの配列とデータの間の依存を削除する。おそらく
 * 内部専用。ページを削除するときに使う。
 * @private
 */
export const deleteComponentsDependencies = (
  paths: Array<string>
): IDeleteComponentDependenciesAction => {
  return {
    type: `DELETE_COMPONENTS_DEPENDENCIES`,
    payload: {
      paths,
    },
  }
}

/**
 * クエリウォッチャーは、GraphQL クエリを抽出すると、これを呼び出して
 * クエリをそのコンポーネントと一緒に保存する。
 * @private
 */
export const replaceComponentQuery = ({
  query,
  componentPath,
}: {
  query: string
  componentPath: string
}): IReplaceComponentQueryAction => {
  return {
    type: `REPLACE_COMPONENT_QUERY`,
    payload: {
      query,
      componentPath,
    },
  }
}

export const apiFinished = (
  payload: IApiFinishedAction[`payload`]
): IApiFinishedAction => {
  return {
    type: `API_FINISHED`,
    payload,
  }
}

/**
 * クエリウォッチャーは、useStaticQuery から「静的な」GraphQL クエリを抽出すると、
 * これを呼び出してクエリをそのコンポーネントと一緒に保存する。
 * @private
 */
export const replaceStaticQuery = (
  args: {
    name: string
    componentPath: string
    id: string
    query: string
    hash: string
  },
  plugin: IGatsbyPlugin | null | undefined = null
): IReplaceStaticQueryAction => {
  return {
    type: `REPLACE_STATIC_QUERY`,
    plugin,
    payload: args,
  }
}

/**
 *
 * コンポーネントからクエリが抽出されたことを報告する。query-compiler.js が
 * 使う。
 * @private
 */
export const queryExtracted = (
  { componentPath, query }: { componentPath: string; query: string },
  plugin: IGatsbyPlugin,
  traceId?: string
): IQueryExtractedAction => {
  return {
    type: `QUERY_EXTRACTED`,
    plugin,
    traceId,
    payload: { componentPath, query },
  }
}

/**
 * フラグメントの抽出などのために Definitions を設定する。
 *
 * vscode-graphql や graphiql などの開発者ツールが使う
 *
 * query-compiler.js。
 * @private
 */
export const setGraphQLDefinitions = (
  definitionsByName: Map<string, IDefinitionMeta>
): ISetGraphQLDefinitionsAction => {
  return {
    type: `SET_GRAPHQL_DEFINITIONS`,
    payload: definitionsByName,
  }
}

/**
 *
 * Relay Compiler がクエリを抽出しようとして graphql のエラーを見つけたことを報告する
 * @private
 */
export const queryExtractionGraphQLError = (
  { componentPath, error }: { componentPath: string; error: string },
  plugin: IGatsbyPlugin,
  traceId?: string
): IQueryExtractionGraphQLErrorAction => {
  return {
    type: `QUERY_EXTRACTION_GRAPHQL_ERROR`,
    plugin,
    traceId,
    payload: { componentPath, error },
  }
}

/**
 *
 * babel が graphql クエリを抽出できたことを報告する。
 * そのファイルに JS のエラーがないことを示す。
 * @private
 */
export const queryExtractedBabelSuccess = (
  { componentPath },
  plugin: IGatsbyPlugin,
  traceId?: string
): IQueryExtractedBabelSuccessAction => {
  return {
    type: `QUERY_EXTRACTION_BABEL_SUCCESS`,
    plugin,
    traceId,
    payload: { componentPath },
  }
}

/**
 *
 * Relay Compiler がクエリを抽出しようとして babel のエラーを見つけたことを報告する
 * @private
 */
export const queryExtractionBabelError = (
  { componentPath, error }: { componentPath: string; error: Error },
  plugin: IGatsbyPlugin,
  traceId?: string
): IQueryExtractionBabelErrorAction => {
  return {
    type: `QUERY_EXTRACTION_BABEL_ERROR`,
    plugin,
    traceId,
    payload: { componentPath, error },
  }
}

/**
 * プログラム全体のステータスを設定する。たとえば `BOOTSTRAPING` や `BOOTSTRAP_FINISHED`。
 * @private
 */
export const setProgramStatus = (
  status: ProgramStatus,
  plugin: IGatsbyPlugin,
  traceId?: string
): ISetProgramStatusAction => {
  return {
    type: `SET_PROGRAM_STATUS`,
    plugin,
    traceId,
    payload: status,
  }
}

/**
 * ページのクエリが実行されたことを通知する。
 * @private
 */
export const pageQueryRun = (
  payload: IPageQueryRunAction[`payload`],
  plugin: IGatsbyPlugin,
  traceId?: string
): IPageQueryRunAction => {
  return {
    type: `PAGE_QUERY_RUN`,
    plugin,
    traceId,
    payload,
  }
}

export const queryStart = (
  { path, componentPath, isPage },
  plugin: IGatsbyPlugin,
  traceId?: string
): IQueryStartAction => {
  return {
    type: `QUERY_START`,
    plugin,
    traceId,
    payload: { path, componentPath, isPage },
  }
}

export const clearDirtyQueriesListToEmitViaWebsocket =
  (): IQueryClearDirtyQueriesListToEmitViaWebsocket => {
    return {
      type: `QUERY_CLEAR_DIRTY_QUERIES_LIST_TO_EMIT_VIA_WEBSOCKET`,
    }
  }

/**
 * 古くなったと印が付いているジョブ（inputPath が存在しない）を取り除く
 * @private
 */
export const removeStaleJob = (
  contentDigest: string,
  plugin?: IGatsbyPlugin,
  traceId?: string
): IRemoveStaleJobAction => {
  return {
    type: `REMOVE_STALE_JOB_V2`,
    plugin,
    traceId,
    payload: {
      contentDigest,
    },
  }
}

/**
 * gatsby の config を設定する
 * @private
 */
export const setSiteConfig = (config?: unknown): ISetSiteConfig => {
  const result = gatsbyConfigSchema.validate(config || {})
  const normalizedPayload = result.value as IGatsbyConfig

  if (result.error) {
    const hasUnknownKeys = result.error.details.filter(
      details => details.type === `object.unknown`
    )

    if (Array.isArray(hasUnknownKeys) && hasUnknownKeys.length) {
      const errorMessages = hasUnknownKeys.map(unknown => {
        const { context, message } = unknown
        const key = context?.key
        const suggestion = key && didYouMean(key)

        if (suggestion) {
          return `${message}. ${suggestion}`
        }

        return message
      })

      reporter.panic({
        id: `10122`,
        context: {
          sourceMessage: errorMessages.join(`\n`),
        },
      })
    }

    reporter.panic({
      id: `10122`,
      context: {
        sourceMessage: result.error.message,
      },
    })
  }

  return {
    type: `SET_SITE_CONFIG`,
    payload: normalizedPayload,
  }
}

/**
 * gatsby の関数を設定する
 * @private
 */
export const setFunctions = (
  functions: IGatsbyState[`functions`]
): ISetSiteFunctions => {
  return {
    type: `SET_SITE_FUNCTIONS`,
    payload: functions,
  }
}

export const deleteNodeManifests = (): IDeleteNodeManifests => {
  return {
    type: `DELETE_NODE_MANIFESTS`,
  }
}

export const createJobV2FromInternalJob =
  (internalJob: InternalJob): ICreateJobV2FromInternalAction =>
  (dispatch, getState): Promise<Record<string, unknown>> => {
    const jobContentDigest = internalJob.contentDigest
    const currentState = getState()

    // このジョブを以前に実行したかを確認し、実行済みであれば結果を返す
    // 処理中に同じリソースを二重に消費しないように、ジョブマネージャーの中に
    // 実行中（進行中）のキューを持っている
    if (
      currentState.jobsV2 &&
      currentState.jobsV2.complete.has(jobContentDigest)
    ) {
      return Promise.resolve(
        currentState.jobsV2.complete.get(jobContentDigest)!.result
      )
    }
    const engineContext = getEngineContext()

    // engineContext が undefined であっても、常にコンテキストを設定する。
    // こうするのは、あるエンジンリクエストに対する最終的なジョブの一覧に、次の両方が含まれるためである。
    //  - 同じ requestId を持つジョブ
    //  - requestId を持たないジョブ（厳密には requestId === "" のジョブ）
    //
    // 非同期コンテキストが失われるケースについては
    // https://nodejs.org/dist/latest-v16.x/docs/api/async_context.html#async_context_troubleshooting_context_loss を参照。
    dispatch({
      type: `SET_JOB_V2_CONTEXT`,
      payload: {
        job: internalJob,
        requestId: engineContext?.requestId ?? ``,
      },
    })

    const inProgressJobPromise = getInProcessJobPromise(jobContentDigest)
    if (inProgressJobPromise) {
      return inProgressJobPromise
    }

    dispatch({
      type: `CREATE_JOB_V2`,
      payload: {
        job: internalJob,
      },
      plugin: { name: internalJob.plugin.name },
    })

    const enqueuedJobPromise = enqueueJob(internalJob)
    return enqueuedJobPromise.then(result => {
      // 次回の実行で使えるように、結果を redux に保存する
      dispatch({
        type: `END_JOB_V2`,
        plugin: { name: internalJob.plugin.name },
        payload: {
          jobContentDigest,
          result,
        },
      })

      // このジョブは done の状態から参照できるので、inProgressJobQueue から取り除く。
      // これは、gatsby preview を使うときにメモリーが増えすぎないようにするためのパフォーマンス最適化である
      removeInProgressJob(jobContentDigest)

      return result
    })
  }

export const clearGatsbyImageSourceUrls =
  (): IClearGatsbyImageSourceUrlAction => {
    return {
      type: `CLEAR_GATSBY_IMAGE_SOURCE_URL`,
    }
  }
