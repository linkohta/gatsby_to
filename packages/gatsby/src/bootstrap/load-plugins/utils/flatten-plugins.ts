import { IPluginInfo } from "../types"

// すべてのサブプラグインをトップレベルに引き上げた、「平坦化した」プラグインの
// 配列を作成する。これにより、サブプラグインの gatsby-* ファイルの
// 実行が単純になる。
export const flattenPlugins = (
  plugins: Array<IPluginInfo>
): Array<IPluginInfo> => {
  const flattened: Array<IPluginInfo> = []
  const extractPlugins = (plugin: IPluginInfo): void => {
    if (plugin.subPluginPaths) {
      for (const subPluginPath of plugin.subPluginPaths) {
        // @pieh:
        // subPluginPath は someOption.randomFieldThatIsMarkedAsSubplugins のような形になる
        // パスを . 区切りの文字列にしたのは、subPluginPaths 配列での重複を防ぎやすかったためである
        // （gatsby-config 内の各サブプラグインがサブプラグインのパスを追加するため）。
        const segments = subPluginPath.split(`.`)
        let roots: Array<any> = [plugin.pluginOptions]
        for (const segment of segments) {
          if (segment === `[]`) {
            roots = roots.flat()
          } else {
            roots = roots.map(root => root[segment])
          }
        }
        roots = roots.flat()

        roots.forEach(subPlugin => {
          flattened.push(subPlugin)
          extractPlugins(subPlugin)
        })
      }
    }
  }

  plugins.forEach(plugin => {
    flattened.push(plugin)
    extractPlugins(plugin)
  })

  return flattened
}
