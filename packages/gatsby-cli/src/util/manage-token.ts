import { getConfigStore } from "gatsby-core-utils"
import report from "../reporter"

const tokenKey = `cli.token`
const tokenExpirationKey = `cli.tokenExpiration`

const getExpiration = (): string =>
  getConfigStore().get(tokenExpirationKey) as string
export const getToken = async (): Promise<string> => {
  const expiration = await getExpiration()
  const tokenHasExpired = new Date() > new Date(expiration)
  if (tokenHasExpired) {
    report.warn(`Your token has expired, you may need to login again`)
  }
  return getConfigStore().get(tokenKey) as string
}

export const setToken = (token: string | null, expiration: string): void => {
  const store = getConfigStore()

  store.set(tokenKey, token)
  // JWT から有効期限をデコードできるはずだが、認証サービスはトークンに有効期限を付ける設定になっていない
  store.set(tokenExpirationKey, expiration)
}
