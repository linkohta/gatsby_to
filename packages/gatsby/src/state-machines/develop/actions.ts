import {
  assign as xstateAssign,
  AnyEventObject,
  DoneActorEvent,
  ErrorActorEvent,
  NonReducibleUnknown,
  ProvidedActor,
} from "xstate"
import { IBuildContext } from "../../services"
import { actions } from "../../redux/actions"
import { listenForMutations } from "../../services/listen-for-mutations"
import { DataLayerResult } from "../data-layer"
import { saveState } from "../../redux/save-state"
import reporter from "gatsby-cli/lib/reporter"
import { store } from "../../redux"
import { ProgramStatus } from "../../redux/types"
import { createWebpackWatcher } from "../../services/listen-to-webpack"
import { callRealApi } from "../../utils/call-deferred-api"
import {
  writeGraphQLFragments,
  writeGraphQLSchema,
} from "../../utils/graphql-typegen/file-writes"
import { writeTypeScriptTypes } from "../../utils/graphql-typegen/ts-codegen"

interface IBuildActionArgs {
  context: IBuildContext
  event: AnyEventObject
}

// 型引数を省くと、関数を渡さない `assign({ ... })` のコンテキストが推論されず、
// マシンのアクションとして渡せない。そのため、このマシンの型で固定しておく
const assign = xstateAssign<
  IBuildContext,
  AnyEventObject,
  NonReducibleUnknown,
  AnyEventObject,
  ProvidedActor
>

/**
 * ノードを変更できるべきハンドラーの中にいる場合のハンドラー
 * キューに入れずに、すぐに呼び出す
 */
export const callApi = ({
  context: { store },
  event,
}: IBuildActionArgs): void => callRealApi(event.payload, store)

/**
 * ノードの変更を処理する準備ができていないすべての状態で使うイベント
 * ハンドラー。処理する代わりにバッチに追加し、次にアイドルになったときに処理する
 */
export const addNodeMutation = assign({
  nodeMutationBatch: ({
    context: { nodeMutationBatch = [] },
    event: { payload },
  }: IBuildActionArgs) => {
    // きれいではないが、concat よりずっと速い
    nodeMutationBatch.push(payload)
    return nodeMutationBatch
  },
})

export const assignStoreAndWorkerPool = assign(
  ({ event }: IBuildActionArgs) => {
    const { store, workerPool } = (event as DoneActorEvent<any>).output
    return {
      store,
      workerPool,
    }
  }
)

const setQueryRunningFinished = async (): Promise<void> => {
  store.dispatch(
    actions.setProgramStatus(ProgramStatus.BOOTSTRAP_QUERY_RUNNING_FINISHED)
  )
}

export const markQueryFilesDirty = assign({
  queryFilesDirty: true,
})

export const markSourceFilesDirty = assign(
  ({ context, event }: IBuildActionArgs) => {
    const prev = context.changedSourceFiles ?? new Set()
    return {
      sourceFilesDirty: true,
      changedSourceFiles: prev.add(event.payload ?? event.file),
    }
  }
)

export const markSourceFilesClean = assign({
  sourceFilesDirty: false,
  changedSourceFiles: () => new Set<string>(),
})

export const setRecompiledFiles = assign(({ context }: IBuildActionArgs) => {
  return {
    recompiledFiles: context.changedSourceFiles,
  }
})

export const markNodesDirty = assign({
  nodesMutatedDuringQueryRun: true,
})

export const markNodesClean = assign({
  nodesMutatedDuringQueryRun: false,
})

export const incrementRecompileCount = assign({
  nodesMutatedDuringQueryRunRecompileCount: ({
    context: { nodesMutatedDuringQueryRunRecompileCount: count = 0 },
  }: IBuildActionArgs) => {
    reporter.verbose(
      `Re-running queries because nodes mutated during query run. Count: ${
        count + 1
      }`
    )
    return count + 1
  },
})

export const resetRecompileCount = assign({
  nodesMutatedDuringQueryRunRecompileCount: 0,
  nodesMutatedDuringQueryRun: false,
})

export const assignServiceResult = assign(
  ({ event }: IBuildActionArgs): DataLayerResult =>
    (event as DoneActorEvent<DataLayerResult>).output
)

/**
 * さまざまな変更イベントを `emitter` で監視するサービスを起動する
 */
export const spawnMutationListener = assign({
  mutationListener: ({ spawn }) =>
    spawn(listenForMutations, { id: `listen-for-mutations` }),
})

export const assignServers = assign(({ event }: IBuildActionArgs) => {
  return {
    ...(event as DoneActorEvent<Partial<IBuildContext>>).output,
  }
})

export const spawnWebpackListener = assign({
  webpackListener: ({ context: { compiler }, spawn }) => {
    if (!compiler) {
      return undefined
    }
    return spawn(createWebpackWatcher(compiler))
  },
})

export const assignWebhookBody = assign({
  webhookBody: ({ event: { payload } }: IBuildActionArgs) =>
    payload?.webhookBody,
  webhookSourcePluginName: ({ event: { payload } }: IBuildActionArgs) =>
    payload?.pluginName,
})

export const clearWebhookBody = assign({
  webhookBody: undefined,
  webhookSourcePluginName: undefined,
})

export const finishParentSpan = ({
  context: { parentSpan },
}: IBuildActionArgs): void => parentSpan?.finish()

export const saveDbState = (): Promise<void> => saveState()

// 失敗したサービスが投げた値は、xstate 5 ではイベントの `error` に入る
type ReportableError = Parameters<typeof reporter.error>[0]

export const logError = ({ event }: IBuildActionArgs): void => {
  reporter.error((event as ErrorActorEvent).error as ReportableError)
}

export const panic = ({ event }: IBuildActionArgs): void => {
  reporter.panic((event as ErrorActorEvent).error as ReportableError)
}

export const panicBecauseOfInfiniteLoop = (): void => {
  reporter.panic(
    reporter.stripIndent(`
  Panicking because nodes appear to be being changed every time we run queries. This would cause the site to recompile infinitely.
  Check custom resolvers to see if they are unconditionally creating or mutating nodes on every query.
  This may happen if they create nodes with a field that is different every time, such as a timestamp or unique id.`)
  )
}

export const trackRequestedQueryRun = assign({
  pendingQueryRuns: ({ context, event: { payload } }: IBuildActionArgs) => {
    const pendingQueryRuns = context.pendingQueryRuns || new Set<string>()
    if (payload?.pagePath) {
      pendingQueryRuns.add(payload.pagePath)
    }
    return pendingQueryRuns
  },
})

export const clearPendingQueryRuns = assign(() => {
  return {
    pendingQueryRuns: new Set<string>(),
  }
})

export const schemaTypegen = async ({
  context,
  event,
}: IBuildActionArgs): Promise<void> => {
  const schema = event.payload.payload
  const directory = context.program.directory

  context.reporter!.verbose(`Re-Generating schema.graphql`)

  try {
    await writeGraphQLSchema(directory, schema)
  } catch (err) {
    context.reporter!.panicOnBuild({
      id: `12100`,
      context: {
        sourceMessage: err,
      },
    })
  }
}

export const definitionsTypegen = async ({
  context,
  event,
}: IBuildActionArgs): Promise<void> => {
  const definitions = event.payload.payload
  const { schema, config } = context.store!.getState()
  const directory = context.program.directory
  const graphqlTypegenOptions = config.graphqlTypegen

  if (!graphqlTypegenOptions) {
    throw new Error(`graphqlTypegen option is falsy. This should never happen.`)
  }

  context.reporter!.verbose(`Re-Generating fragments.graphql & TS Types`)

  try {
    await writeGraphQLFragments(directory, definitions)
    await writeTypeScriptTypes(
      directory,
      schema,
      definitions,
      graphqlTypegenOptions
    )
  } catch (err) {
    context.reporter!.panicOnBuild({
      id: `12100`,
      context: {
        sourceMessage: err,
      },
    })
  }
}

export const buildActions = {
  callApi,
  markNodesDirty,
  addNodeMutation,
  spawnMutationListener,
  assignStoreAndWorkerPool,
  assignServiceResult,
  assignServers,
  markQueryFilesDirty,
  assignWebhookBody,
  clearWebhookBody,
  finishParentSpan,
  spawnWebpackListener,
  markSourceFilesDirty,
  markSourceFilesClean,
  setRecompiledFiles,
  markNodesClean,
  incrementRecompileCount,
  resetRecompileCount,
  panicBecauseOfInfiniteLoop,
  saveDbState,
  setQueryRunningFinished,
  panic,
  logError,
  trackRequestedQueryRun,
  clearPendingQueryRuns,
  schemaTypegen,
  definitionsTypegen,
}
