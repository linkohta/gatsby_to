import { createRequire } from "module"
import * as path from "path"
import {
  IGatsbyConfigInput,
  mergeGatsbyConfig,
  PluginEntry,
  IPluginEntryWithParentDir,
} from "../../utils/merge-gatsby-config"
import { mapSeries } from "bluebird"
import { flattenDeep, isEqual, isFunction, uniqWith } from "lodash"
import DebugCtor from "debug"
import { preferDefault } from "../prefer-default"
import { getConfigFile } from "../get-config-file"
import { resolvePlugin } from "../load-plugins/resolve-plugin"
import reporter from "gatsby-cli/lib/reporter"

const debug = DebugCtor(`gatsby:load-themes`)

interface IThemeObj {
  themeName: string
  themeConfig: IGatsbyConfigInput
  themeDir: string
  themeSpec: PluginEntry
  parentDir: string
  configFilePath?: string
}

// テーマの gatsby-config ファイルを取得する
const resolveTheme = async (
  themeSpec: PluginEntry,
  configFileThatDeclaredTheme: string | undefined,
  isMainConfig: boolean = false,
  rootDir: string
): Promise<IThemeObj> => {
  const themeName =
    typeof themeSpec === `string` ? themeSpec : themeSpec.resolve
  let themeDir
  try {
    const scopedRequire = createRequire(`${rootDir}/:internal:`)
    // テーマは Node で解決可能なモジュールである
    themeDir = path.dirname(scopedRequire.resolve(themeName))
  } catch (e) {
    let pathToLocalTheme

    // ローカルテーマはメインのサイトでだけ探す
    // 他のテーマにネストされたローカルテーマは、問題の原因になりうる。
    // それらは npm でホスティングされていないので、同じ名前で異なる動作をする
    // ローカルテーマが複数存在する可能性がある。現在 Gatsby は名前を主な
    // 識別子として使っているので、今のところは対応しないほうが安全である。
    if (isMainConfig) {
      pathToLocalTheme = path.join(rootDir, `plugins`, themeName)
      // ローカルプラグインであるか、または存在しない
      try {
        const { resolve } = resolvePlugin(themeName, rootDir)
        themeDir = resolve
      } catch (localErr) {
        reporter.panic(`Failed to resolve ${themeName}`, localErr)
      }
    }

    if (!themeDir) {
      const nodeResolutionPaths = module.paths.map(p => path.join(p, themeName))
      reporter.panic({
        id: `10226`,
        context: {
          themeName,
          configFilePath: configFileThatDeclaredTheme,
          pathToLocalTheme,
          nodeResolutionPaths,
        },
      })
    }
  }

  const { configModule, configFilePath } = await getConfigFile(
    themeDir,
    `gatsby-config`
  )
  const theme:
    | IGatsbyConfigInput
    | ((options?: Record<string, unknown>) => IGatsbyConfigInput) =
    preferDefault(configModule)

  // テーマが関数の場合は、themeConfig を渡して呼び出す
  const themeConfig = isFunction(theme)
    ? theme(typeof themeSpec === `string` ? {} : themeSpec.options)
    : theme

  return {
    themeName,
    themeConfig,
    themeSpec,
    themeDir,
    parentDir: rootDir,
    configFilePath,
  }
}

// 親テーマを解決する再帰関数の 1 回分の処理
// 再帰的なのは、子テーマが親を宣言することに対応しており、
// 親子関係の `up the tree` を最後までたどって解決する必要があるためである
//
// 理論上はここで無限ループになりうるが、実際にはループになるユースケースは
// ないので、誰かが大きく道を外れて独自のテーマ群を作っている場合にしか
// 起こらないと考えている
const processTheme = (
  { themeName, themeConfig, themeSpec, themeDir, configFilePath }: IThemeObj,
  { rootDir }: { rootDir: string }
): Promise<Array<IThemeObj>> => {
  const themesList = themeConfig && themeConfig.plugins
  // Gatsby のテーマは gatsby-config.js を指定しなくてもよい（gatsby-node などだけを使うこともある）
  // その場合は厳密にはプラグインだが、それでも対応すべきである。
  // テーマの作者がどのファイルを最初に作るかは保証できないためである
  if (themeConfig && themesList) {
    // テーマが定義する親テーマごとに、親の gatsby-config を解決し、
    // [parentA, parentB, child] の順で返す
    return mapSeries(
      themesList,
      async (spec: PluginEntry): Promise<Array<IThemeObj>> => {
        const themeObj = await resolveTheme(
          spec,
          configFilePath,
          false,
          themeDir
        )
        return processTheme(themeObj, { rootDir: themeDir })
      }
    ).then(arr =>
      flattenDeep(
        arr.concat([
          { themeName, themeConfig, themeSpec, themeDir, parentDir: rootDir },
        ])
      )
    )
  } else {
    // テーマが追加のテーマを定義していない場合は、元のテーマを返す
    return Promise.resolve([
      { themeName, themeConfig, themeSpec, themeDir, parentDir: rootDir },
    ])
  }
}

function normalizePluginEntry(
  plugin: PluginEntry,
  parentDir: string
): IPluginEntryWithParentDir {
  return {
    resolve: typeof plugin === `string` ? plugin : plugin.resolve,
    options: typeof plugin === `string` ? {} : plugin.options || {},
    parentDir,
  }
}

export async function loadThemes(
  config: IGatsbyConfigInput,
  { configFilePath, rootDir }: { configFilePath: string; rootDir: string }
): Promise<{
  config: IGatsbyConfigInput
  themes: Array<IThemeObj>
}> {
  const themesA = await mapSeries(
    config.plugins || [],
    async (themeSpec: PluginEntry) => {
      const themeObj = await resolveTheme(
        themeSpec,
        configFilePath,
        true,
        rootDir
      )
      return processTheme(themeObj, { rootDir })
    }
  ).then(arr => flattenDeep(arr))

  // デバッグの助けになるよう、平坦化したテーマの一覧をログに出力する
  debug(themesA)

  // 各テーマを順に処理し、テーマ自身をそのテーマの設定の plugins
  // 一覧に追加する。これにより、テーマで gatsby-node などを
  // 使えるようになる。
  return (
    mapSeries(
      themesA,
      ({ themeName, themeConfig = {}, themeSpec, themeDir, parentDir }) => {
        return {
          ...themeConfig,
          plugins: [
            ...(themeConfig.plugins || []).map(plugin =>
              normalizePluginEntry(plugin, themeDir)
            ),
            // テーマのプラグインは最後に置く。通常のサイトと同じように、その gatsby-node などが、宣言されたプラグインを上書きできるようにするためである。
            {
              resolve: themeName,
              options: typeof themeSpec === `string` ? {} : themeSpec.options,
              parentDir,
            },
          ],
        }
      }
    )
      /**
       * テーマは gatsby-config に解決されるので、ここですべての設定を
       * 1 つの設定にマージする。その際、定義された順序を必ず維持し、
       * ユーザーのサイトや子テーマのような後の設定が、前のテーマの機能を
       * 上書きできるようにする。
       */
      .reduce(mergeGatsbyConfig, {})
      .then(newConfig => {
        const mergedConfig = mergeGatsbyConfig(newConfig, {
          ...config,
          plugins: [
            ...(config.plugins || []).map(plugin =>
              normalizePluginEntry(plugin, rootDir)
            ),
          ],
        })

        mergedConfig.plugins = uniqWith(mergedConfig.plugins, isEqual)

        return {
          config: mergedConfig,
          themes: themesA,
        }
      })
  )
}
