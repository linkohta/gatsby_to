import { IGatsbyState, IEnableStatefulSourcePluginAction } from "../types"

/**
 * ソースプラグインに「ステートフル」のフラグを立てる。これは、プラグインがデータの更新を自分で管理し、Gatsby が `sourceNodes` の実行のたびに「古い」ノードを探さないことを意味する。
 */
export const statefulSourcePluginsReducer = (
  statefulSourcePlugins: IGatsbyState[`statefulSourcePlugins`] = new Set(),
  action: IEnableStatefulSourcePluginAction
): IGatsbyState[`statefulSourcePlugins`] => {
  switch (action.type) {
    case `ENABLE_STATEFUL_SOURCE_PLUGIN`: {
      statefulSourcePlugins.add(action.plugin.name)

      return statefulSourcePlugins
    }
    default:
      return statefulSourcePlugins
  }
}
