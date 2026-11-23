import { MachineConfig, assign, createMachine } from "xstate"
import { IWaitingContext } from "./types"
import { waitingActions } from "./actions"
import { waitingServices } from "./services"

const NODE_MUTATION_BATCH_SIZE = 100
const NODE_MUTATION_BATCH_TIMEOUT = 500
const FILE_CHANGE_AGGREGATION_TIMEOUT = 200

export type WaitingResult = Pick<IWaitingContext, `nodeMutationBatch`>

/**
 * このアイドル状態は、ノードの変更のバッチ処理と、最初に開始したときの
 * 変更の実行も扱う
 */
export const waitingStates: MachineConfig<IWaitingContext, any, any> = {
  predictableActionArguments: true,
  id: `waitingMachine`,
  initial: `idle`,
  context: {
    nodeMutationBatch: [],
    runningBatch: [],
  },
  states: {
    idle: {
      always: [
        {
          // キューに入っているノードの変更がすでにある場合は、
          // すぐにバッチ処理へ移る
          cond: (ctx): boolean => !!ctx.nodeMutationBatch.length,
          target: `batchingNodeMutations`,
        },
        {
          // この状態に入った時点でソースファイルがダーティである場合は、
          // 再コンパイルを強制するために、すぐに aggregatingFileChanges へ移る
          // https://github.com/gatsbyjs/gatsby/issues/27609 を参照
          target: `aggregatingFileChanges`,
          cond: ({ sourceFilesDirty }): boolean => Boolean(sourceFilesDirty),
        },
      ],
      on: {
        ADD_NODE_MUTATION: {
          actions: `addNodeMutation`,
          target: `batchingNodeMutations`,
        },
        // これを監視するのはアイドル中だけである。他の時点で受け取った場合は、
        // いずれにしてもページの作成などを行うためである
        SOURCE_FILE_CHANGED: {
          target: `aggregatingFileChanges`,
        },
      },
    },
    aggregatingFileChanges: {
      // やれやれ。これは、webpack が Watchpack の集約されたファイル無効化イベントを
      // 公開していないためである。すぐにコンパイルすると、
      // 変更されたファイルを拾えない
      after: {
        // 集約のタイムアウト
        [FILE_CHANGE_AGGREGATION_TIMEOUT]: {
          actions: `extractQueries`,
          target: `idle`,
        },
      },
      on: {
        ADD_NODE_MUTATION: {
          actions: `addNodeMutation`,
          target: `batchingNodeMutations`,
        },
        SOURCE_FILE_CHANGED: {
          target: undefined,
          // 外部の自己遷移がタイマーをリセットする
          internal: false,
        },
      },
    },
    batchingNodeMutations: {
      // 入った時点でバッチがすでにいっぱいかを確認する
      always: {
        cond: (ctx): boolean =>
          ctx.nodeMutationBatch.length >= NODE_MUTATION_BATCH_SIZE,
        target: `committingBatch`,
      },
      on: {
        // バッチにさらに変更が追加された
        ADD_NODE_MUTATION: [
          // ご存じのとおり、最初に一致した遷移だけが実行される
          {
            // これでバッチがいっぱいになる場合は、コミットする
            actions: `addNodeMutation`,
            cond: (ctx): boolean =>
              ctx.nodeMutationBatch.length >= NODE_MUTATION_BATCH_SIZE,
            target: `committingBatch`,
          },
          {
            // ...そうでなければ、バッチに追加するだけである
            actions: `addNodeMutation`,
          },
        ],
      },
      after: {
        // 時間切れ
        [NODE_MUTATION_BATCH_TIMEOUT]: `committingBatch`,
      },
    },
    committingBatch: {
      entry: assign<IWaitingContext>(({ nodeMutationBatch }) => {
        return {
          nodeMutationBatch: [],
          runningBatch: nodeMutationBatch,
        }
      }),
      on: {
        // バッチの実行中は、新しいアクションも実行する。連鎖的に発生したものかもしれないためである
        ADD_NODE_MUTATION: {
          actions: `callApi`,
        },
      },
      invoke: {
        src: `runMutationBatch`,
        // 終わったら、次回に備えて実行中のバッチを消去する
        onDone: {
          actions: assign<IWaitingContext, any>({
            runningBatch: [],
          }),
          target: `rebuild`,
        },
      },
    },
    rebuild: {
      type: `final`,
      // これは親に返される。このバッチには、もう一方のバッチの
      // 実行中に届いた変更がすべて含まれる
      data: ({ nodeMutationBatch }): WaitingResult => {
        return { nodeMutationBatch }
      },
    },
  },
}

export const waitingMachine = createMachine(waitingStates, {
  actions: waitingActions,
  services: waitingServices,
})
