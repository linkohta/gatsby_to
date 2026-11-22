// このメタデータをスキーマの推論に利用するために、ノードの構造を追跡する
// 型の記述子はどの時点でも有効であり続けるので、インクリメンタルな推論が簡単になる
import { omit } from "lodash"
import {
  addNode,
  addNodes,
  deleteNode,
  ignore,
  disable,
} from "../../schema/infer/inference-metadata"
import { NodeInterfaceFields } from "../../schema/types/node-interface"
import { typesWithoutInference } from "../../schema/types/type-defs"

import { IGatsbyState, ActionsUnion } from "../types"

const ignoredFields: Set<string> = new Set(NodeInterfaceFields)

const initialTypeMetadata = (): { ignoredFields: Set<string> } => {
  return { ignoredFields }
}

const incrementalReducer = (
  state: IGatsbyState["inferenceMetadata"]["typeMap"] = {},
  action: ActionsUnion
): IGatsbyState["inferenceMetadata"]["typeMap"] => {
  switch (action.type) {
    case `CREATE_TYPES`: {
      const typeDefs = Array.isArray(action.payload)
        ? action.payload
        : [action.payload]
      const ignoredTypes = typeDefs.reduce(typesWithoutInference, [])
      ignoredTypes.forEach(type => {
        state[type] = ignore(state[type] || initialTypeMetadata())
      })
      return state
    }

    case `BUILD_TYPE_METADATA`: {
      // 既存のメタデータを上書きする
      const { nodes, typeName, clearExistingMetadata } = action.payload
      if (!state[typeName]?.ignored) {
        const initialMetadata =
          clearExistingMetadata || !state[typeName]
            ? initialTypeMetadata()
            : state[typeName]

        state[typeName] = addNodes(initialMetadata, nodes)
      }
      return state
    }

    case `DISABLE_TYPE_INFERENCE`: {
      // 注: ここで無効にした型は、BUILD_TYPE_METADATA の後に再び有効になる
      const types = action.payload
      types.forEach(type => {
        state[type] = disable(state[type] || initialTypeMetadata())
      })
      return state
    }

    case `CREATE_NODE`: {
      const { payload: node, oldNode } = action
      const { type } = node.internal
      if (oldNode) {
        state[type] = deleteNode(state[type] || initialTypeMetadata(), oldNode)
      }
      state[type] = addNode(state[type] || initialTypeMetadata(), node)
      return state
    }

    case `DELETE_NODE`: {
      const node = action.payload
      if (!node) return state
      const { type } = node.internal
      state[type] = deleteNode(state[type] || initialTypeMetadata(), node)
      return state
    }

    case `ADD_FIELD_TO_NODE`: {
      const { payload: node, addedField } = action
      const { type } = node.internal

      // 先に以前のフィールドの登録を解除しなければならない。
      // 単純に { fields: { [addedField]: node.fields[addedField] } } を追加することはできない。
      // 同じノードについて `fields` キーを 2 回数えてしまうためである
      const previousFields = omit(node.fields, [addedField])
      state[type] = deleteNode(state[type], { ...node, fields: previousFields })
      state[type] = addNode(state[type], { ...node, fields: node.fields })

      // TODO: 同じフィールドが 2 回「追加」されるエッジケースがあるかもしれない。
      //   その場合、メタデータで 2 回数えることになる。避ける方法として考えられるのは、
      //   アクションのペイロードで、変更前の元のノードを新しいノードと一緒に渡し、
      //   上の deleteNode の呼び出しで元の `node.fields` を使うことだけである
      return state
    }

    case `ADD_CHILD_NODE_TO_PARENT_NODE`: {
      // 親の型が再ビルドされるように、ダーティの印を付ける
      const { type } = action.payload.internal
      state[type].dirty = true
      return state
    }

    case `SET_SCHEMA`: {
      Object.keys(state).forEach(type => {
        state[type].dirty = false
      })
      return state
    }

    default:
      return state
  }
}

enum StepsEnum {
  initialBuild = `initialBuild`,
  incrementalBuild = `incrementalBuild`,
}

const initialState = (): IGatsbyState["inferenceMetadata"] => {
  return {
    step: StepsEnum.initialBuild, // `initialBuild` | `incrementalBuild`
    typeMap: {},
  }
}

export const inferenceMetadataReducer = (
  state: IGatsbyState["inferenceMetadata"] = initialState(),
  action: ActionsUnion
): IGatsbyState["inferenceMetadata"] => {
  switch (action.type) {
    case `CREATE_NODE`:
    case `DELETE_NODE`:
    case `ADD_CHILD_NODE_TO_PARENT_NODE`:
    case `ADD_FIELD_TO_NODE`: {
      // パフォーマンス: 最初のスキーマのビルドまでは、インクリメンタルな推論を無効にする。
      // bootstrap 中に大量のノードを作成して削除するプラグインがあり、
      // そのせいでこのレデューサーが不要な処理を大量に行うことになる。
      // 代わりに、最初のメタデータの作成を最初のスキーマのビルドまで遅らせ、
      // その後にインクリメンタルな更新を明示的に有効にする
      if (state.step === StepsEnum.initialBuild) {
        return state
      }
      state.typeMap = incrementalReducer(state.typeMap, action)
      return state
    }

    case `START_INCREMENTAL_INFERENCE`: {
      return {
        ...state,
        step: StepsEnum.incrementalBuild,
      }
    }

    case `DELETE_CACHE`: {
      return initialState()
    }

    default: {
      state.typeMap = incrementalReducer(state.typeMap, action)
      return state
    }
  }
}
