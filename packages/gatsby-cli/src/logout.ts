import reporter from "./reporter"
import { setToken } from "./util/manage-token"

/**
 * 設定ストアからトークンを削除して Gatsby Cloud からログアウトするメインの関数。
 */
export async function logout(): Promise<void> {
  await setToken(null, ``)
  reporter.info(`You have been logged out of Gatsby Cloud from this device.`)
}
