import { IWaitingContext } from "../state-machines/waiting/types"
import { callRealApi } from "../utils/call-deferred-api"

// バッチ全体を消費して、アクションを実行する
export const runMutationBatch = async ({
  runningBatch = [],
  store,
}: Partial<IWaitingContext>): Promise<Array<void>> =>
  Promise.all(runningBatch.map(payload => callRealApi(payload, store)))
