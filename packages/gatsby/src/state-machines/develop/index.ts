import {
  MachineConfig,
  AnyEventObject,
  forwardTo,
  createMachine,
  assign,
} from "xstate"
import { IDataLayerContext } from "../data-layer/types"
import { IQueryRunningContext } from "../query-running/types"
import { IWaitingContext } from "../waiting/types"
import { buildActions } from "./actions"
import { developServices } from "./services"
import { contextAsInput } from "../from-service"
import { IBuildContext } from "../../services"

const RECOMPILE_PANIC_LIMIT = 6

const getGraphqlTypegenConfig = (ctx: IBuildContext): boolean =>
  !!ctx.store!.getState().config.graphqlTypegen

/**
 * これは `gatsby develop` コマンドのトップレベルのステートマシンである
 */
const developConfig: MachineConfig<IBuildContext, AnyEventObject> = {
  id: `build`,
  // マシンを起動するときに `input` で渡した値を、そのままコンテキストにする
  context: ({ input }: { input: IBuildContext }) => input,
  initial: `initializing`,
  // これらは変更イベントであり、`services/listen-for-mutations.ts` の
  // 変更リスナーからこのマシンへ送られる
  on: {
    // これらは遅延されたノードの変更であり、主に `createNode` である
    ADD_NODE_MUTATION: {
      actions: `addNodeMutation`,
    },
    // webpack または chokidar がファイルの変更を検出したときに送られる
    SOURCE_FILE_CHANGED: {
      actions: `markSourceFilesDirty`,
    },
    // これらは refresh エンドポイントへの呼び出しである。Gatsby Preview でも使われる。
    // イベントの webhook のボディをコンテキストに保存し、データを再読み込みする
    WEBHOOK_RECEIVED: {
      target: `.reloadingData`,
      actions: `assignWebhookBody`,
    },
    QUERY_RUN_REQUESTED: {
      actions: `trackRequestedQueryRun`,
    },
    SET_SCHEMA: {
      actions: `schemaTypegen`,
      guard: ({ context }): boolean =>
        getGraphqlTypegenConfig(context) && !context.shouldRunInitialTypegen,
    },
    SET_GRAPHQL_DEFINITIONS: {
      actions: `definitionsTypegen`,
      guard: ({ context }): boolean =>
        getGraphqlTypegenConfig(context) && !context.shouldRunInitialTypegen,
    },
  },
  states: {
    // ここで最初の bootstrap を処理する
    initializing: {
      on: {
        // いずれにしてもすべてを実行するので、変更イベントは無視する
        // （空の遷移を置くと、ルートのハンドラーへ伝わらなくなる）
        ADD_NODE_MUTATION: {},
        SOURCE_FILE_CHANGED: {},
        WEBHOOK_RECEIVED: {},
      },
      invoke: {
        id: `initialize`,
        src: `initialize`,
        input: contextAsInput,
        onDone: {
          target: `initializingData`,
          actions: [`assignStoreAndWorkerPool`, `spawnMutationListener`],
        },
        onError: {
          actions: `panic`,
        },
      },
    },
    // ノードを取得し、スキーマをカスタマイズして推論し、その後 createPages を実行する
    initializingData: {
      on: {
        // この状態では、変更をすぐに実行する必要がある
        ADD_NODE_MUTATION: {
          actions: `callApi`,
        },
      },
      invoke: {
        id: `initialize-data`,
        src: `initializeData`,
        input: ({
          context: { parentSpan, store, webhookBody, program, reporter },
        }): IDataLayerContext => {
          return {
            parentSpan,
            store,
            webhookBody,
            shouldRunCreatePagesStatefully: true,
            deferNodeMutation: true,
            program,
            reporter,
          }
        },
        onDone: {
          actions: [
            `assignServiceResult`,
            `clearWebhookBody`,
            `finishParentSpan`,
          ],
          target: `runningPostBootstrap`,
        },
        onError: {
          actions: `logError`,
          target: `waiting`,
        },
      },
    },
    runningPostBootstrap: {
      invoke: {
        id: `post-bootstrap`,
        src: `postBootstrap`,
        input: contextAsInput,
        onDone: `runningQueries`,
      },
    },
    // ページクエリと静的クエリを実行し、SSR した HTML とページデータを生成する
    runningQueries: {
      on: {
        SOURCE_FILE_CHANGED: {
          actions: [forwardTo(`run-queries`), `markSourceFilesDirty`],
        },
        ADD_NODE_MUTATION: {
          actions: [`markNodesDirty`, `callApi`],
        },
        QUERY_RUN_REQUESTED: {
          actions: forwardTo(`run-queries`),
        },
      },
      invoke: {
        id: `run-queries`,
        src: `runQueries`,
        // これが、子のマシンへ送るデータのすべてである
        input: ({
          context: {
            program,
            store,
            parentSpan,
            gatsbyNodeGraphQLFunction,
            graphqlRunner,
            websocketManager,
            pendingQueryRuns,
            reporter,
          },
        }): IQueryRunningContext => {
          return {
            program,
            store,
            parentSpan,
            gatsbyNodeGraphQLFunction,
            graphqlRunner,
            websocketManager,
            pendingQueryRuns,
            reporter,
          }
        },
        onDone: [
          {
            // 再コンパイルの上限に達していて、ノードが再び変更された場合は panic にする
            target: `waiting`,
            actions: `panicBecauseOfInfiniteLoop`,
            guard: ({
              context: {
                nodesMutatedDuringQueryRun = false,
                nodesMutatedDuringQueryRunRecompileCount = 0,
              },
            }): boolean =>
              nodesMutatedDuringQueryRun &&
              nodesMutatedDuringQueryRunRecompileCount >= RECOMPILE_PANIC_LIMIT,
          },
          {
            // クエリの実行中にノードが変更されたので、すべてを再実行する必要がある
            target: `recreatingPages`,
            guard: ({ context: { nodesMutatedDuringQueryRun } }): boolean =>
              !!nodesMutatedDuringQueryRun,
            actions: [
              `markNodesClean`,
              `incrementRecompileCount`,
              `clearPendingQueryRuns`,
            ],
          },
          {
            // コンパイラーがない場合（つまり初回の実行）は、webpack と socket.io の
            // サーバーを起動する
            target: `startingDevServers`,
            actions: [`setQueryRunningFinished`, `clearPendingQueryRuns`],
            guard: ({ context: { compiler } }): boolean => !compiler,
          },
          {
            // ソースファイルが変更されている場合は、JS バンドルを再コンパイルする
            target: `recompiling`,
            guard: ({ context: { sourceFilesDirty } }): boolean =>
              !!sourceFilesDirty,
            actions: [`clearPendingQueryRuns`],
          },
          {
            // ...そうでなければ、待つだけである。
            target: `waiting`,
            actions: [`clearPendingQueryRuns`],
          },
        ],
        onError: {
          actions: [`logError`, `clearPendingQueryRuns`],
          target: `waiting`,
        },
      },
      exit: assign({ shouldRunInitialTypegen: false }),
    },
    // JS バンドルを再コンパイルする
    recompiling: {
      // 重要: 再コンパイルの開始時に、ソースファイルをクリーンとして印を付ける
      // これを `onDone` で行うと、再コンパイルの **途中** で起きたファイル変更イベントがすべて消えてしまう
      // https://github.com/gatsbyjs/gatsby/issues/27609 を参照
      entry: [`setRecompiledFiles`, `markSourceFilesClean`],
      invoke: {
        src: `recompile`,
        input: contextAsInput,
        onDone: {
          target: `waiting`,
        },
        onError: {
          actions: `logError`,
          target: `waiting`,
        },
      },
    },
    // webpack と socket.io を起動する
    startingDevServers: {
      invoke: {
        src: `startWebpackServer`,
        input: contextAsInput,
        onDone: [
          {
            target: `initialGraphQLTypegen`,
            guard: ({ context }): boolean => getGraphqlTypegenConfig(context),
          },
          {
            target: `waiting`,
          },
        ],
        onError: {
          actions: `panic`,
          target: `waiting`,
        },
      },
      exit: [`assignServers`, `spawnWebpackListener`, `markSourceFilesClean`],
    },
    initialGraphQLTypegen: {
      invoke: {
        src: `graphQLTypegen`,
        input: contextAsInput,
        onDone: {
          target: `waiting`,
        },
        onError: {
          actions: `logError`,
          target: `waiting`,
        },
      },
    },
    // アイドル状態。再ビルドのきっかけになるイベントを待つ
    waiting: {
      always: [
        {
          target: `runningQueries`,
          guard: ({ context: { pendingQueryRuns } }): boolean =>
            !!pendingQueryRuns && pendingQueryRuns.size > 0,
        },
      ],
      entry: [`saveDbState`, `resetRecompileCount`],
      on: {
        // バッチ処理を扱えるように、これらのイベントを子のマシンへ転送する
        ADD_NODE_MUTATION: {
          actions: forwardTo(`waiting`),
        },
        SOURCE_FILE_CHANGED: {
          actions: [forwardTo(`waiting`), `markSourceFilesDirty`],
        },
        // このイベントは子から送られる
        EXTRACT_QUERIES_NOW: {
          target: `runningQueries`,
        },
      },
      invoke: {
        id: `waiting`,
        src: `waitForMutations`,
        // キューに入っている既存の変更を子のマシンへ送り、子がそれらを実行する
        input: ({
          context: { store, nodeMutationBatch = [], sourceFilesDirty },
        }): IWaitingContext => {
          return {
            store,
            nodeMutationBatch,
            sourceFilesDirty,
            runningBatch: [],
          }
        },
        // "done" は、再ビルドが必要であることを意味する
        onDone: {
          actions: `assignServiceResult`,
          target: `recreatingPages`,
        },
        onError: {
          actions: `panic`,
        },
      },
    },
    // データの初期化とほぼ同じだが、初回の実行に関するさまざまな処理をスキップする
    reloadingData: {
      on: {
        // この状態では、変更をすぐに実行する必要がある
        ADD_NODE_MUTATION: {
          actions: `callApi`,
        },
      },
      invoke: {
        src: `reloadData`,
        input: ({
          context: {
            parentSpan,
            store,
            webhookBody,
            webhookSourcePluginName,
            program,
            reporter,
          },
        }): IDataLayerContext => {
          return {
            parentSpan,
            store,
            webhookBody,
            webhookSourcePluginName,
            refresh: true,
            deferNodeMutation: true,
            shouldRunCreatePagesStatefully: false,
            program,
            reporter,
          }
        },
        onDone: {
          actions: [
            `assignServiceResult`,
            `clearWebhookBody`,
            `finishParentSpan`,
          ],
          target: `runningQueries`,
        },
        onError: {
          actions: `logError`,
          target: `waiting`,
        },
      },
    },
    // sourceNodes の外でノードが変更された場合は、ページを再ビルドする
    recreatingPages: {
      on: {
        // この状態では、変更をすぐに実行する必要がある
        ADD_NODE_MUTATION: {
          actions: `callApi`,
        },
      },
      invoke: {
        id: `recreate-pages`,
        src: `recreatePages`,
        input: ({
          context: { parentSpan, store, program, reporter },
        }): IDataLayerContext => {
          return {
            parentSpan,
            store,
            program,
            deferNodeMutation: true,
            shouldRunCreatePagesStatefully: false,
            reporter,
          }
        },
        onDone: {
          actions: `assignServiceResult`,
          target: `runningQueries`,
        },
        onError: {
          actions: `logError`,
          target: `waiting`,
        },
      },
    },
  },
}

export const developMachine = createMachine(developConfig, {
  actors: developServices,
  actions: buildActions,
})
