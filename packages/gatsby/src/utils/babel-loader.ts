import babelLoader from "babel-loader"
import type { Compiler } from "webpack"
import Babel, { ConfigItem } from "@babel/core"
import {
  prepareOptions,
  getCustomOptions,
  mergeConfigItemOptions,
  addRequiredPresetOptions,
  ICustomOptions,
} from "./babel-loader-helpers"
import type { Stage } from "../commands/types"
import { getBrowsersList } from "./browserslist"

/**
 * webpack と babel のための Gatsby 独自のローダー
 *
 * Gatsby では、サイトは Gatsby の Babel の構成（デフォルト）を使うことも、
 * .babelrc を追加して自分で制御することもできる。
 *
 * デフォルトの構成は、下の fallbackPlugins/fallbackPresets 配列で
 * 定義している。
 *
 * フォールバックまたはユーザーが用意した構成を使った後に、いくつかの
 * 必須のプラグインを追加し、最後に、Gatsby のプラグインが渡した
 * プリセットとプラグインをマージする。
 *
 * 独自のローダーのドキュメントはこちら: https://babeljs.io/docs/en/next/babel-core.html#loadpartialconfig
 */

interface IBabelCustomLoader {
  custom: ICustomOptions
  loader: Record<string, unknown>
}

const customOptionsCache = new Map()
const configCache = new Map()
const babelrcFileToCacheKey = new Map()

const customBabelLoader = babelLoader.custom(babel => {
  return {
    // ローダーのオプションが渡される。
    customOptions({
      stage = `test` as Stage,
      reactRuntime = `classic`,
      reactImportSource,
      isPageTemplate,
      resourceQuery,
      rootDir = process.cwd(),
      ...options
    }): IBabelCustomLoader {
      const customOptionsCacheKey = `${stage}-${isPageTemplate}-${resourceQuery}`

      if (customOptionsCache.has(customOptionsCacheKey)) {
        return customOptionsCache.get(customOptionsCacheKey)
      }

      const toReturn = {
        custom: {
          stage,
          reactRuntime,
          reactImportSource,
          isPageTemplate,
          resourceQuery,
        },
        loader: {
          cacheIdentifier: JSON.stringify({
            browsersList: getBrowsersList(rootDir),
            babel: babel.version,
            gatsbyPreset: require(`babel-preset-gatsby/package.json`).version,
            env: babel.getEnv(),
          }),
          sourceType: `unambiguous`,
          ...getCustomOptions(stage as Stage),
          ...options,
        },
      }

      customOptionsCache.set(customOptionsCacheKey, toReturn)

      return toReturn
    },

    // Babel の 'PartialConfig' オブジェクトが渡される。
    config(partialConfig, { customOptions }): Babel.TransformOptions {
      const { stage, isPageTemplate, resourceQuery } = customOptions
      let configCacheKey = `${stage}-${isPageTemplate}-${resourceQuery}`

      if (partialConfig.hasFilesystemConfig()) {
        // partialConfig.files は、使われた設定ファイル（絶対パス）を蓄積する Set である
        partialConfig.files.forEach(configFilePath => {
          configCacheKey += `_${configFilePath}`
        })

        // configCacheKey を生成した後に、babelrc ファイルと、それに依存するキャッシュキーを結び付ける
        // これにより、使われている babelrc ファイルが変わったときに、メモ化した設定を無効化できる
        partialConfig.files.forEach(configFilePath => {
          let cacheKeysToInvalidate = babelrcFileToCacheKey.get(configFilePath)
          if (!cacheKeysToInvalidate) {
            cacheKeysToInvalidate = new Set()
            babelrcFileToCacheKey.set(configFilePath, cacheKeysToInvalidate)
          }

          cacheKeysToInvalidate.add(configCacheKey)
        })
      }

      let { options } = partialConfig
      if (configCache.has(configCacheKey)) {
        return { ...options, ...configCache.get(configCacheKey) }
      }

      const [
        reduxPresets,
        reduxPlugins,
        requiredPresets,
        requiredPlugins,
        fallbackPresets,
      ] = prepareOptions(babel, customOptions)

      // ファイルシステムに babel の設定がない場合は、フォールバックの
      // プリセットとプラグインを追加する。
      if (!partialConfig.hasFilesystemConfig()) {
        options = {
          ...options,
          plugins: requiredPlugins,
          presets: [...fallbackPresets, ...requiredPresets],
        }
      } else {
        // babelrc がある場合は、必須のプラグインとプリセットだけを追加する
        options = {
          ...options,
          plugins: [...options.plugins, ...requiredPlugins],
          presets: [...options.presets, ...requiredPresets],
        }
        // ユーザー定義のプリセットには、`babel-preset-gatsby` が含まれている可能性が高い
        // 必須の動的なオプション（たとえば `stage`）を必ず渡すようにする:
        addRequiredPresetOptions(babel, options.presets, customOptions)
      }

      // gatsby のプラグインが追加したプリセットとプラグインをマージする。
      reduxPresets.forEach(preset => {
        options.presets = mergeConfigItemOptions({
          items: options.presets,
          itemToMerge: preset as ConfigItem,
          type: `preset`,
          babel,
        })
      })

      reduxPlugins.forEach(plugin => {
        options.plugins = mergeConfigItemOptions({
          items: options.plugins,
          itemToMerge: plugin as ConfigItem,
          type: `plugin`,
          babel,
        })
      })

      // プラグインとプリセットだけをキャッシュする。config にはファイル名なども
      // 含まれるためである。これは主に、ファイルごとに `mergeConfigItemOptions` を
      // 呼ばないようにするためである。この関数は `babel.createConfigItem` を呼ぶのでかなりコストが高い。
      // それに加えて、ネストしたループもかなり省ける
      configCache.set(configCacheKey, {
        plugins: options.plugins,
        presets: options.presets,
      })

      return options
    },
  }
})

export default customBabelLoader

export class BabelConfigItemsCacheInvalidatorPlugin {
  name: string

  constructor() {
    this.name = `BabelConfigItemsCacheInvalidatorPlugin`
  }

  apply(compiler: Compiler): void {
    compiler.hooks.invalid.tap(this.name, function (file) {
      const cacheKeysToInvalidate = babelrcFileToCacheKey.get(file)

      if (cacheKeysToInvalidate) {
        for (const cacheKey of cacheKeysToInvalidate) {
          configCache.delete(cacheKey)
        }
        babelrcFileToCacheKey.delete(file)
      }
    })
  }
}
