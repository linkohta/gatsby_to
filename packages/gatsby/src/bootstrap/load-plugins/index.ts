import reporter from "gatsby-cli/lib/reporter"
import { store } from "../../redux"
import { IGatsbyState } from "../../redux/types"
import * as nodeAPIs from "../../utils/api-node-docs"
import * as browserAPIs from "../../utils/api-browser-docs"
import ssrAPIs from "../../../cache-dir/api-ssr-docs"
import { loadInternalPlugins } from "./load-internal-plugins"
import {
  collatePluginAPIs,
  handleBadExports,
  handleMultipleReplaceRenderers,
  validateConfigPluginsOptions,
} from "./validate"
import { IFlattenedPlugin } from "./types"
import { normalizeConfig } from "./utils/normalize"
import { getAPI } from "./utils/get-api"
import { flattenPlugins } from "./utils/flatten-plugins"
import { IGatsbyConfig } from "../../internal"

export async function loadPlugins(
  rawConfig: IGatsbyConfig,
  rootDir: string
): Promise<Array<IFlattenedPlugin>> {
  // plugins: [`...`] 内のすべての文字列を { resolve: ``, options: {} } の形に変換する
  const config = normalizeConfig(rawConfig)

  // 無効なプラグイン設定に対するエラーを表示する
  await validateConfigPluginsOptions(config, rootDir)

  const currentAPIs = getAPI({
    browser: browserAPIs,
    node: nodeAPIs,
    ssr: ssrAPIs,
  })

  // 内部プラグイン、サイト設定のプラグイン、サイトのデフォルトプラグインをまとめる
  const pluginInfos = loadInternalPlugins(config, rootDir)

  // プラグインを平坦化した配列を作成する
  const pluginArray = flattenPlugins(pluginInfos)

  const { disablePlugins } = store.getState().program
  const pluginArrayWithoutDisabledPlugins = pluginArray.filter(plugin => {
    const disabledInfo = disablePlugins?.find(
      entry => entry.name === plugin.name
    )

    if (disabledInfo) {
      if (!process.env.GATSBY_WORKER_ID) {
        // この警告はメインプロセスで 1 回だけ表示する
        reporter.warn(
          `Disabling plugin "${plugin.name}":\n${disabledInfo.reasons
            .map(line => ` - ${line}`)
            .join(`\n`)}`
        )
      }
      return false
    }
    return true
  })

  // どのプラグインがどの API を使っているかを割り出す。有効な Gatsby API ではないもの
  // （いわゆる 'badExports'）も含む
  let { flattenedPlugins, badExports } = await collatePluginAPIs({
    currentAPIs,
    flattenedPlugins: pluginArrayWithoutDisabledPlugins,
    rootDir,
  })

  // プラグインが export している Gatsby 以外の API についてエラーを表示する
  await handleBadExports({ currentAPIs, badExports })

  // ReplaceRenderer が複数回実装されている場合にエラーを表示する
  flattenedPlugins = handleMultipleReplaceRenderers({
    flattenedPlugins,
  })

  // ここまで来れば、すべて問題ない。store を更新する
  store.dispatch({
    type: `SET_SITE_FLATTENED_PLUGINS`,
    payload: flattenedPlugins as IGatsbyState["flattenedPlugins"],
  })

  return flattenedPlugins
}
