import Configstore from "configstore"

let config: Configstore
/**
 * gatsby に関連する configstore のインスタンスを取得する
 * @return gatsby 用の ConfigStore インスタンス
 */

export const getConfigStore = (): Configstore => {
  if (!config) {
    config = new Configstore(
      `gatsby`,
      {},
      {
        globalConfigPath: true,
      }
    )
  }

  return config
}
