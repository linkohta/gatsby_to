import { slash } from "gatsby-core-utils"
import { uniqWith, isEqual } from "lodash"
import path from "path"
import { store } from "../../redux"
import {
  IPluginInfo,
  IPluginRefObject,
  IPluginRefOptions,
  ISiteConfig,
} from "./types"
import { processPlugin } from "./process-plugin"
import { createPluginId } from "./utils/create-id"
import { createFileContentHash } from "./utils/create-hash"
import { getResolvedFieldsForPlugin } from "../../utils/parcel/compile-gatsby-files"

const TYPESCRIPT_PLUGIN_NAME = `gatsby-plugin-typescript`

export function loadInternalPlugins(
  config: ISiteConfig = {},
  rootDir: string
): Array<IPluginInfo> {
  // プラグインをインスタンス化する。
  const plugins: Array<IPluginInfo> = []
  const configuredPluginNames = new Set()

  // 内部プラグインを追加する
  const internalPlugins = [
    `../../internal-plugins/dev-404-page`,
    `../../internal-plugins/load-babel-config`,
    `../../internal-plugins/internal-data-bridge`,
    `../../internal-plugins/prod-404-500`,
    `../../internal-plugins/webpack-theme-component-shadowing`,
    `../../internal-plugins/bundle-optimisations`,
    `../../internal-plugins/functions`,
  ].filter(Boolean) as Array<string>

  internalPlugins.forEach(relPath => {
    const absPath = path.join(__dirname, relPath)
    plugins.push(processPlugin(absPath, rootDir))
  })

  // サイトの設定からプラグインを追加する。
  if (config.plugins) {
    config.plugins.forEach(plugin => {
      const processedPlugin = processPlugin(plugin, rootDir)
      plugins.push(processedPlugin)
      configuredPluginNames.add(processedPlugin.name)
    })
  }

  // これらの page-creator はすべて順序が重要である。「最後のプラグインが勝つ」ので、
  // ユーザーのサイトが最後に来る。それより前の各 page-creator インスタンスは、
  // プラグインの定義順と一致していなければならない。テーマについてはこれで問題ない。
  // テーマは、すでに正しい順序で plugins 配列に追加されている
  // ためである
  plugins.forEach(plugin => {
    plugins.push(
      processPlugin(
        {
          resolve: require.resolve(`gatsby-plugin-page-creator`),
          options: {
            path: slash(path.join(plugin.resolve, `src/pages`)),
            pathCheck: false,
          },
        },
        rootDir
      )
    )
  })

  // デフォルトで Typescript に対応するが、ユーザーが上書きできるようにする
  if (!configuredPluginNames.has(TYPESCRIPT_PLUGIN_NAME)) {
    const processedTypeScriptPlugin = processPlugin(
      {
        resolve: require.resolve(TYPESCRIPT_PLUGIN_NAME),
        options: {
          // TODO(@mxstbr): これらのデフォルト値をハードコードせず、
          // gatsby-plugin-typescript の pluginOptionsSchema から推論する
          allExtensions: false,
          isTSX: false,
          jsxPragma: `React`,
        },
      },
      rootDir
    )
    plugins.push(processedTypeScriptPlugin)
  }

  // サイトのデフォルトの「プラグイン」、つまりサイトのルートにある gatsby-x ファイルを追加する。
  plugins.push({
    resolve: slash(process.cwd()),
    id: createPluginId(`default-site-plugin`),
    name: `default-site-plugin`,
    version: createFileContentHash(process.cwd(), `gatsby-*`),
    pluginOptions: {
      plugins: [],
    },
    ...getResolvedFieldsForPlugin(rootDir, `default-site-plugin`),
  })

  const program = store.getState().program

  // gatsby-plugin-page-creator のデフォルトのオプション
  let pageCreatorOptions: IPluginRefOptions | undefined = {
    path: slash(path.join(program.directory, `src/pages`)),
    pathCheck: false,
  }

  if (config.plugins) {
    const pageCreatorPlugin = config.plugins.find(
      (plugin): plugin is IPluginRefObject =>
        typeof plugin !== `string` &&
        plugin.resolve === `gatsby-plugin-page-creator` &&
        slash((plugin.options && plugin.options.path) || ``) ===
          slash(path.join(program.directory, `src/pages`))
    )
    if (pageCreatorPlugin) {
      // ユーザーが指定したオプションがあれば、オプションを上書きする
      pageCreatorOptions = pageCreatorPlugin.options
    }
  }

  const processedPageCreatorPlugin = processPlugin(
    {
      resolve: require.resolve(`gatsby-plugin-page-creator`),
      options: pageCreatorOptions,
    },
    rootDir
  )

  plugins.push(processedPageCreatorPlugin)

  // Partytown プラグインは `wrapRootElement` の中で <Script strategy={"off-main-thread"} /> の
  // 使用を収集する。そのため、ユーザーが自分の `wrapRootElement` で注入するスクリプトも
  // 収集できるよう、必ず最後に実行されるようにする必要がある
  plugins.push(
    processPlugin(
      path.join(__dirname, `../../internal-plugins/partytown`),
      rootDir
    )
  )

  const uniquePlugins = uniqWith(plugins, isEqual)

  return uniquePlugins
}
