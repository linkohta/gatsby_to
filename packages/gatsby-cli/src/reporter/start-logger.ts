/*
 * このモジュールは、適切なロガーを読み込むための、副作用だらけのモジュールである。
 */
import semver from "semver"
import { isCI } from "gatsby-core-utils"

export const startLogger = (): void => {
  if (!process.env.GATSBY_LOGGER) {
    if (
      semver.satisfies(process.version, `>=8`) &&
      !isCI() &&
      typeof jest === `undefined`
    ) {
      process.env.GATSBY_LOGGER = `ink`
    } else {
      process.env.GATSBY_LOGGER = `yurnalist`
    }
  }
  // 子プロセスの場合は ipc ロガーを使う
  if (process.send && !process.env.GATSBY_WORKER_POOL_WORKER) {
    // FIXME: ワーカー内では IPC ロガーを無効にする。IPC メッセージは jest-worker をクラッシュさせる。
    // これは、ワーカーのコンテキストで reporter を使ったときにプロセスがクラッシュしないようにするための回避策にすぎない。
    // process.env.FORCE_COLOR = `0`

    // TODO 動的 import に移行する
    require(`./loggers/ipc`).initializeIPCLogger()
  }

  if (process.env.GATSBY_LOGGER.includes(`json`)) {
    // TODO 動的 import に移行する
    require(`./loggers/json`).initializeJSONLogger()
  } else if (process.env.GATSBY_LOGGER.includes(`yurnalist`)) {
    // TODO 動的 import に移行する
    require(`./loggers/yurnalist`).initializeYurnalistLogger()
  } else {
    // TODO 動的 import に移行する
    require(`./loggers/ink`).initializeINKLogger()
  }
}
