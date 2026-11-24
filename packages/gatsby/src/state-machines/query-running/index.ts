import { MachineConfig, createMachine, assign, AnyEventObject } from "xstate"
import { IQueryRunningContext } from "./types"
import { queryRunningServices } from "./services"
import { queryActions } from "./actions"
import { contextAsInput } from "../from-service"

/**
 * これは子のステートマシンであり、クエリを実行するために起動される
 */

const PAGE_QUERY_ENQUEUING_TIMEOUT = 50

export const queryStates: MachineConfig<IQueryRunningContext, AnyEventObject> =
  {
    // 親のマシンが invoke の `input` で渡した値を、そのままコンテキストにする
    context: ({ input }: { input?: IQueryRunningContext }) => input ?? {},
    initial: `extractingQueries`,
    id: `queryRunningMachine`,
    on: {
      SOURCE_FILE_CHANGED: {
        actions: `markSourceFilesDirty`,
      },
      QUERY_RUN_REQUESTED: {
        actions: `trackRequestedQueryRun`,
      },
    },
    states: {
      extractingQueries: {
        id: `extracting-queries`,
        invoke: {
          id: `extracting-queries`,
          src: `extractQueries`,
          input: contextAsInput,
          onDone: {
            target: `waitingPendingQueries`,
          },
        },
      },
      // この状態は、"extractQueries" の完了が早すぎるという理由だけで存在する。
      // 抽出されたクエリが実行用のキューに入れられる前に完了してしまう。
      // その結果、calculateDirtyQueries からそれらのクエリが見えず、実行されない。
      //
      // こうなるのは、抽出されたクエリが、redux/machines/page-component のアクションの中で
      // setTimeout(x, 0) でラップされて実行用のキューに入れられ、それが "extractQueries" の完了後に発火するためである。
      //
      // https://github.com/gatsbyjs/gatsby/issues/26580 を参照
      //
      // FIXME: 抽出されたすべてのクエリが実行用のキューに入るまで "extractingQueries" 状態を
      //   抜けないようにして、きちんと直す必要がある（ただしリファクタリングが必要になる）
      waitingPendingQueries: {
        id: `waiting-pending-queries`,
        after: {
          [PAGE_QUERY_ENQUEUING_TIMEOUT]: {
            target: `writingRequires`,
            actions: `markSourceFilesClean`,
          },
        },
      },
      writingRequires: {
        invoke: {
          src: `writeOutRequires`,
          input: contextAsInput,
          id: `writing-requires`,
          onDone: {
            target: `calculatingDirtyQueries`,
          },
        },
      },
      calculatingDirtyQueries: {
        entry: assign(({ context: { pendingQueryRuns } }) => {
          return {
            pendingQueryRuns: new Set<string>(),
            currentlyHandledPendingQueryRuns: pendingQueryRuns,
          }
        }),
        invoke: {
          id: `calculating-dirty-queries`,
          src: `calculateDirtyQueries`,
          input: contextAsInput,
          onDone: {
            target: `runningStaticQueries`,
            actions: [
              `assignDirtyQueries`,
              `clearCurrentlyHandledPendingQueryRuns`,
            ],
          },
        },
      },
      runningStaticQueries: {
        invoke: {
          src: `runStaticQueries`,
          input: contextAsInput,
          id: `running-static-queries`,
          onDone: {
            target: `runningPageQueries`,
          },
        },
      },
      runningPageQueries: {
        invoke: {
          src: `runPageQueries`,
          input: contextAsInput,
          id: `running-page-queries`,
          onDone: {
            target: `runningSliceQueries`,
          },
        },
      },
      runningSliceQueries: {
        invoke: {
          src: `runSliceQueries`,
          input: contextAsInput,
          id: `running-slice-queries`,
          onDone: {
            target: `waitingForJobs`,
            actions: `flushPageData`,
          },
        },
      },
      // jobs API の完了を待つ
      waitingForJobs: {
        // ファイルがダーティであれば、もう一度抽出する
        always: [
          {
            guard: ({ context }): boolean => !!context.filesDirty,
            target: `extractingQueries`,
          },
          {
            guard: ({ context: { pendingQueryRuns } }): boolean =>
              !!pendingQueryRuns && pendingQueryRuns.size > 0,
            target: `calculatingDirtyQueries`,
          },
        ],
        invoke: {
          src: `waitUntilAllJobsComplete`,
          input: contextAsInput,
          id: `waiting-for-jobs`,
          onDone: {
            target: `done`,
          },
        },
      },
      done: {
        type: `final`,
      },
    },
  }
export const queryRunningMachine = createMachine(queryStates, {
  actions: queryActions,
  actors: queryRunningServices,
})
