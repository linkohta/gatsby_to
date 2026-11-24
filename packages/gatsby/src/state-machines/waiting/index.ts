import { MachineConfig, assign, createMachine, AnyEventObject } from "xstate"
import { IWaitingContext } from "./types"
import { waitingActions } from "./actions"
import { waitingServices } from "./services"
import { contextAsInput } from "../from-service"

const NODE_MUTATION_BATCH_SIZE = 100
const NODE_MUTATION_BATCH_TIMEOUT = 500
const FILE_CHANGE_AGGREGATION_TIMEOUT = 200

export type WaitingResult = Pick<IWaitingContext, `nodeMutationBatch`>

/**
 * このアイドル状態は、ノードの変更のバッチ処理と、最初に開始したときの
 * 変更の実行も扱う
 */
export const waitingStates: MachineConfig<IWaitingContext, AnyEventObject> = {
  id: `waitingMachine`,
  initial: `idle`,
  // 親のマシンが invoke の `input` で渡した値を、そのままコンテキストにする
  context: ({ input }: { input?: IWaitingContext }) =>
    input ?? {
      nodeMutationBatch: [],
      runningBatch: [],
    },
  // これは親に返される。このバッチには、もう一方のバッチの
  // 実行中に届いた変更がすべて含まれる
  output: ({ context: { nodeMutationBatch } }): WaitingResult => {
    return { nodeMutationBatch }
  },
  states: {
    idle: {
      always: [
        {
          // キューに入っているノードの変更がすでにある場合は、
          // すぐにバッチ処理へ移る
          guard: ({ context }): boolean => !!context.nodeMutationBatch.length,
          target: `batchingNodeMutations`,
        },
        {
          // この状態に入った時点でソースファイルがダーティである場合は、
          // 再コンパイルを強制するために、すぐに aggregatingFileChanges へ移る
          // https://github.com/gatsbyjs/gatsby/issues/27609 を参照
          target: `aggregatingFileChanges`,
          guard: ({ context: { sourceFilesDirty } }): boolean =>
            Boolean(sourceFilesDirty),
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
        // NOTE: xstate 4 のときは `target: undefined` と `internal: false` を指定していて、コメントには
        // 「外部の自己遷移がタイマーをリセットする」とあった。しかし、ターゲットのない遷移では
        // 状態に入り直さないので、実際にはタイマーはリセットされていなかった。その動作を保っている
        SOURCE_FILE_CHANGED: {},
      },
    },
    batchingNodeMutations: {
      // 入った時点でバッチがすでにいっぱいかを確認する
      always: {
        guard: ({ context }): boolean =>
          context.nodeMutationBatch.length >= NODE_MUTATION_BATCH_SIZE,
        target: `committingBatch`,
      },
      on: {
        // バッチにさらに変更が追加された
        ADD_NODE_MUTATION: [
          // ご存じのとおり、最初に一致した遷移だけが実行される
          {
            // これでバッチがいっぱいになる場合は、コミットする
            actions: `addNodeMutation`,
            guard: ({ context }): boolean =>
              context.nodeMutationBatch.length >= NODE_MUTATION_BATCH_SIZE,
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
      entry: assign(({ context: { nodeMutationBatch } }) => {
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
        input: contextAsInput,
        // 終わったら、次回に備えて実行中のバッチを消去する
        onDone: {
          actions: assign({
            runningBatch: [],
          }),
          target: `rebuild`,
        },
      },
    },
    rebuild: {
      type: `final`,
    },
  },
}

export const waitingMachine = createMachine(waitingStates, {
  actions: waitingActions,
  actors: waitingServices,
})
