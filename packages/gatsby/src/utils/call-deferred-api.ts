import { assertStore } from "./assert-store"
import { Store } from "redux"
import { IMutationAction } from "../services"
import { actions } from "../redux/actions"
import reporter from "gatsby-cli/lib/reporter"
/**
 * これらは、api-runner-node から送られた、遅延された redux のアクションである
 * （createNode アクションの場合は）`resolve` prop を含むことがある。
 * その場合は、処理が終わったときに Promise を解決する
 */
export const callRealApi = (event: IMutationAction, store?: Store): void => {
  assertStore(store)
  const { type, payload, resolve } = event
  if (type in actions) {
    // これが createNode アクションの場合は thunk になる。
    // 問題はない。他のアクションと同じように dispatch するだけである
    const action = actions[type](...payload)
    const result = store.dispatch(action)
    // 誰かがこれを待っているかもしれない
    if (resolve) {
      resolve(result)
    }
  } else {
    reporter.log(`Could not dispatch unknown action "${type}`)
  }
}
