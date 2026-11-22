import {
  AssignAction,
  assign,
  ActionFunctionMap,
  sendParent,
  AnyEventObject,
  ActionFunction,
} from "xstate"
import { IWaitingContext } from "./types"
import { AnyAction } from "redux"
import { callRealApi } from "../../utils/call-deferred-api"

export const callApi: ActionFunction<IWaitingContext, AnyEventObject> = (
  { store },
  event
) => callRealApi(event.payload, store)

/**
 * ノードの変更を処理する準備ができていないときに使うイベントハンドラー。
 * 処理する代わりにバッチに追加し、次にアイドルになったときに処理する
 */
export const addNodeMutation: AssignAction<IWaitingContext, AnyAction> = assign(
  {
    nodeMutationBatch: ({ nodeMutationBatch = [] }, { payload }) => {
      // きれいではないが、concat よりずっと速い
      nodeMutationBatch.push(payload)
      return nodeMutationBatch
    },
  }
)

export const extractQueries = sendParent<IWaitingContext, AnyEventObject>(
  `EXTRACT_QUERIES_NOW`
)

export const waitingActions: ActionFunctionMap<IWaitingContext, AnyAction> = {
  addNodeMutation,
  extractQueries,
  callApi,
}
