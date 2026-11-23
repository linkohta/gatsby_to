import _ from "lodash"
import { IGatsbyState, IRedirect, ICreateRedirectAction } from "../types"

const redirects = new Map<string, Array<IRedirect>>()

function exists(newRedirect: IRedirect): boolean {
  const fromPathRedirects = redirects.get(newRedirect.fromPath)

  if (!fromPathRedirects) return false

  return fromPathRedirects.some(redirect => _.isEqual(redirect, newRedirect))
}

function add(redirect: IRedirect): void {
  let samePathRedirects = redirects.get(redirect.fromPath)

  if (!samePathRedirects) {
    samePathRedirects = []
    redirects.set(redirect.fromPath, samePathRedirects)
  }

  samePathRedirects.push(redirect)
}

export const redirectsReducer = (
  state: IGatsbyState[`redirects`] = [],
  action: ICreateRedirectAction
): IGatsbyState[`redirects`] => {
  switch (action.type) {
    case `CREATE_REDIRECT`: {
      const redirect = action.payload

      // 重複を防ぐために、まだ追加されていない場合にだけリダイレクトを追加する
      if (!exists(redirect)) {
        add(redirect)

        state.push(redirect)
      }

      return state
    }

    default:
      return state
  }
}
