import { IGatsbyState, ISetDomainRequestHeaders } from "../types"

/**
 * setRequestHeaders アクションからドメインとそのドメイン用のヘッダーを受け取り、リクエストを行うときに参照できるように Map に保存する。
 */
export const setRequestHeadersReducer = (
  state: IGatsbyState[`requestHeaders`] = new Map(),
  action: ISetDomainRequestHeaders
): IGatsbyState[`requestHeaders`] => {
  switch (action.type) {
    case `SET_REQUEST_HEADERS`: {
      const { headers, domain } = action.payload

      state.set(domain, headers)
      return state
    }
    default:
      return state
  }
}
