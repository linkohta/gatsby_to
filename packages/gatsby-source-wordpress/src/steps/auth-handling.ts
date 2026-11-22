import type { GatsbyNodeApiHelpers } from "~/utils/gatsby-types"
import type { Step } from "./../utils/run-steps"
import type { IPluginOptions } from "~/models/gatsby-api"

let storedAuthSettings: IPluginOptions["auth"] | undefined

export const hideAuthPluginOptions: Step = async (
  _helpers: GatsbyNodeApiHelpers,
  pluginOptions: IPluginOptions
): Promise<void> => {
  // 後で復元できるよう、認証の設定を保存する
  storedAuthSettings = pluginOptions.auth

  // ブラウザーへ漏れないよう、ブラウザー用のプラグインオプションのモジュールを書き出す前に
  // pluginOptions から認証情報を取り除く
  delete pluginOptions.auth
}

export const restoreAuthPluginOptions: Step = async (
  _helpers: GatsbyNodeApiHelpers,
  pluginOptions: IPluginOptions
): Promise<void> => {
  if (storedAuthSettings) {
    // 認証の設定を保存していた場合は、ブラウザー用のプラグインオプションのモジュールを書き出した後のここで復元し、
    // エンジンが使えるようにする
    pluginOptions.auth = storedAuthSettings
  }
}
