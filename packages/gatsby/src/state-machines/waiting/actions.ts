import { assign, sendParent, AnyEventObject, NonReducibleUnknown } from "xstate"
import { IWaitingContext } from "./types"
import { callRealApi } from "../../utils/call-deferred-api"

interface IWaitingActionArgs {
  context: IWaitingContext
  event: AnyEventObject
}

export const callApi = ({
  context: { store },
  event,
}: IWaitingActionArgs): void => callRealApi(event.payload, store)

/**
 * ノードの変更を処理する準備ができていないときに使うイベントハンドラー。
 * 処理する代わりにバッチに追加し、次にアイドルになったときに処理する
 */
export const addNodeMutation = assign({
  nodeMutationBatch: ({
    context: { nodeMutationBatch = [] },
    event: { payload },
  }: IWaitingActionArgs) => {
    // きれいではないが、concat よりずっと速い
    nodeMutationBatch.push(payload)
    return nodeMutationBatch
  },
})

export const extractQueries = sendParent<
  IWaitingContext,
  AnyEventObject,
  NonReducibleUnknown,
  AnyEventObject,
  AnyEventObject
>({ type: `EXTRACT_QUERIES_NOW` })

export const waitingActions = {
  addNodeMutation,
  extractQueries,
  callApi,
}
