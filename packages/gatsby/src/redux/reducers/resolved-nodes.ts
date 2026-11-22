import merge from "lodash/merge"
import { IGatsbyState, ActionsUnion } from "../types"

export const resolvedNodesCacheReducer = (
  state: IGatsbyState["resolvedNodesCache"] = new Map(),
  action: ActionsUnion
): IGatsbyState["resolvedNodesCache"] => {
  switch (action.type) {
    case `DELETE_CACHE`:
    case `CREATE_NODE`:
    case `DELETE_NODE`:
      return new Map()

    case `SET_RESOLVED_NODES`: {
      const { key, nodes } = action.payload
      const existingResolvedNodes = state.get(key)
      if (existingResolvedNodes) {
        // 指定された型の新しい解決済みフィールドを、既存のものとマージする
        for (const [nodeId, resolvedFields] of nodes.entries()) {
          const previouslyResolvedNodeFields = existingResolvedNodes.get(nodeId)
          if (previouslyResolvedNodeFields) {
            // 指定されたノード ID の新しい解決済みフィールドを、既存のものとマージする
            existingResolvedNodes.set(
              nodeId,
              merge(previouslyResolvedNodeFields, resolvedFields)
            )
          } else {
            // このノード ID の解決済みフィールドはまだなかったので、新しいものを
            // そのまま設定すればよい
            existingResolvedNodes.set(nodeId, resolvedFields)
          }
        }
      } else {
        // この型の解決済みフィールドはまだなかったので、
        // そのまま設定すればよい
        state.set(key, nodes)
      }
      return state
    }

    default:
      return state
  }
}
