import * as path from "path"
import { RuleSetRule, WebpackPluginInstance } from "webpack"
import { GraphQLSchema } from "graphql"
import { Plugin as PostCSSPlugin } from "postcss"
import autoprefixer from "autoprefixer"
import flexbugs from "postcss-flexbugs-fixes"
import TerserPlugin from "terser-webpack-plugin"
import type { MinifyOptions as TerserOptions } from "terser"
import MiniCssExtractPlugin from "mini-css-extract-plugin"
import CssMinimizerPlugin from "css-minimizer-webpack-plugin"
import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin"
import { getBrowsersList } from "./browserslist"
import ESLintPlugin from "eslint-webpack-plugin"
import { cpuCoreCount } from "gatsby-core-utils"
import { GatsbyWebpackStatsExtractor } from "./gatsby-webpack-stats-extractor"
import { getPublicPath } from "./get-public-path"
import {
  GatsbyWebpackVirtualModules,
  VIRTUAL_MODULES_BASE_PATH,
} from "./gatsby-webpack-virtual-modules"

import { builtinPlugins } from "./webpack-plugins"
import { IProgram, Stage } from "../commands/types"
import { eslintConfig, eslintRequiredConfig } from "./eslint-config"
import { store } from "../redux"
import type { RuleSetUseItem } from "webpack"
import { ROUTES_DIRECTORY } from "../constants"

type Loader = string | { loader: string; options?: { [name: string]: any } }
type LoaderResolver<T = Record<string, unknown>> = (options?: T) => Loader

type LoaderOptions = Record<string, any>
type RuleFactory<T = Record<string, unknown>> = (
  options?: T & LoaderOptions
) => RuleSetRule

type ContextualRuleFactory<T = Record<string, unknown>> = RuleFactory<T> & {
  internal?: RuleFactory<T>
  external?: RuleFactory<T>
}

type PluginFactory = (...args: any) => WebpackPluginInstance | null

type BuiltinPlugins = typeof builtinPlugins

type CSSModulesOptions =
  | boolean
  | string
  | {
      mode?:
        | `local`
        | `global`
        | `pure`
        | ((resourcePath: string) => `local` | `global` | `pure`)
      auto?: boolean
      exportGlobals?: boolean
      localIdentName?: string
      localIdentContext?: string
      localIdentHashPrefix?: string
      namedExport?: boolean
      exportLocalsConvention?:
        `asIs` | `camelCaseOnly` | `camelCase` | `dashes` | `dashesOnly`
      exportOnlyLocals?: boolean
    }

type MiniCSSExtractLoaderModuleOptions =
  | undefined
  | boolean
  | {
      namedExport?: boolean
    }
/**
 * webpack の `loader` オブジェクトを生成するユーティリティ
 */
interface ILoaderUtils {
  yaml: LoaderResolver
  style: LoaderResolver
  css: LoaderResolver<{
    url?: boolean | ((url: string, resourcePath: string) => boolean)
    import?:
      boolean | ((url: string, media: string, resourcePath: string) => boolean)
    modules?: CSSModulesOptions
    sourceMap?: boolean
    importLoaders?: number
    esModule?: boolean
  }>
  postcss: LoaderResolver<{
    browsers?: Array<string>
    overrideBrowserslist?: Array<string>
    plugins?: Array<PostCSSPlugin> | ((loader: Loader) => Array<PostCSSPlugin>)
  }>

  file: LoaderResolver
  url: LoaderResolver
  js: LoaderResolver
  json: LoaderResolver
  null: LoaderResolver
  raw: LoaderResolver
  dependencies: LoaderResolver

  miniCssExtract: LoaderResolver
  imports?: LoaderResolver
  exports?: LoaderResolver
}

interface IModuleThatUseGatsby {
  name: string
  path: string
}

type CssLoaderModuleOption = boolean | Record<string, any> | string

/**
 * webpack のルールオブジェクトを生成するユーティリティ
 */
interface IRuleUtils {
  /**
   * babel による JavaScript のコンパイルを扱う
   */
  js: RuleFactory<{ modulesThatUseGatsby?: Array<IModuleThatUseGatsby> }>
  dependencies: RuleFactory<{
    modulesThatUseGatsby?: Array<IModuleThatUseGatsby>
  }>
  yaml: RuleFactory
  fonts: RuleFactory
  images: RuleFactory
  miscAssets: RuleFactory
  media: RuleFactory

  css: ContextualRuleFactory<{
    browsers?: Array<string>
    modules?: CssLoaderModuleOption
  }>
  cssModules: RuleFactory
  postcss: ContextualRuleFactory<{ overrideBrowserOptions: Array<string> }>

  eslint: (schema: GraphQLSchema) => RuleSetRule
  eslintRequired: () => RuleSetRule
}

type PluginUtils = BuiltinPlugins & {
  extractText: PluginFactory
  uglify: PluginFactory
  moment: PluginFactory
  extractStats: PluginFactory
  minifyJs: PluginFactory
  minifyCss: PluginFactory
  fastRefresh: PluginFactory
  eslintGraphqlSchemaReload: PluginFactory
  virtualModules: PluginFactory
  eslint: PluginFactory
  eslintRequired: PluginFactory
}

/**
 * webpack の atoms 名前空間
 */
interface IWebpackUtils {
  loaders: ILoaderUtils

  rules: IRuleUtils

  plugins: PluginUtils
}

const vendorRegex = /(node_modules|bower_components)/

/**
 * atoms 名前空間を生成するファクトリーメソッド
 */
export const createWebpackUtils = (
  stage: Stage,
  program: IProgram
): IWebpackUtils => {
  const assetRelativeRoot = `static/`
  const supportedBrowsers = getBrowsersList(program.directory)

  const PRODUCTION = !stage.includes(`develop`)

  const isSSR = stage.includes(`html`)
  const { config } = store.getState()
  const { assetPrefix, pathPrefix } = config

  const publicPath = getPublicPath({ assetPrefix, pathPrefix, ...program })

  const makeExternalOnly =
    (original: RuleFactory) =>
    (options = {}): RuleSetRule => {
      const rule = original(options)
      rule.include = vendorRegex
      return rule
    }

  const makeInternalOnly =
    (original: RuleFactory) =>
    (options = {}): RuleSetRule => {
      const rule = original(options)
      rule.exclude = vendorRegex
      return rule
    }

  const fileLoaderCommonOptions: {
    name: string
    publicPath?: string
    outputPath?: string
  } = {
    name: `${assetRelativeRoot}[name]-[hash].[ext]`,
  }

  if (stage === `build-html` || stage === `develop-html`) {
    // build-html と develop-html は `.cache/page-ssr/routes/`（ROUTES_DIRECTORY）に出力する
    // そのため、この設定では、"url"（publicPath）を保ったまま、
    // アセットを `public`（outputPath）に出力するようにしている
    fileLoaderCommonOptions.outputPath = path.relative(
      ROUTES_DIRECTORY,
      `public`
    )
    fileLoaderCommonOptions.publicPath = publicPath || `/`
  }

  const loaders: ILoaderUtils = {
    json: (options = {}) => {
      return {
        options,
        loader: require.resolve(`json-loader`),
      }
    },
    yaml: (options = {}) => {
      return {
        loader: require.resolve(`yaml-loader`),
        options: {
          asJSON: true,
          ...options,
        },
      }
    },

    null: (options = {}) => {
      return {
        options,
        loader: require.resolve(`null-loader`),
      }
    },

    raw: (options = {}) => {
      return {
        options,
        loader: require.resolve(`raw-loader`),
      }
    },

    style: (options = {}) => {
      return {
        options,
        loader: require.resolve(`style-loader`),
      }
    },

    // TODO(v5): インラインのローダー構文の破壊的変更とあわせて、https://github.com/gatsbyjs/gatsby/pull/33979 を再適用する
    miniCssExtract: (
      options: {
        modules?: MiniCSSExtractLoaderModuleOptions
      } = {}
    ) => {
      // mini-css-extract-plugin 2 では `modules.namedExport` がなくなり、css-loader の設定に従うようになった。
      // 渡すとオプションの検証でエラーになるので、ここで取り除く。プラグインが `modules` を渡して
      // いることがあるので、引数としては受け付けたままにしている
      const restOptions = { ...options }
      delete restOptions.modules

      return {
        loader: MiniCssExtractPlugin.loader,
        options: restOptions,
      }
    },

    css: (options = {}) => {
      let modulesOptions: CSSModulesOptions = false
      if (options.modules) {
        modulesOptions = {
          auto: undefined,
          namedExport: true,
          localIdentName: `[name]--[local]--[hash:hex:5]`,
          exportLocalsConvention: `dashesOnly`,
          exportOnlyLocals: isSSR,
        }

        if (typeof options.modules === `object`) {
          modulesOptions = {
            ...modulesOptions,
            ...options.modules,
          }
        }
      }

      return {
        loader: require.resolve(`css-loader`),
        options: {
          // 絶対 URL（https または //）は、この関数には渡されない。渡されるのは、絶対または相対の、解決できるパスだけである。
          url: {
            filter: function (url: string): boolean {
              // url が / で始まる場合
              if (url.startsWith(`/`)) {
                return false
              }

              // css-loader 6 以降は data URI もモジュールとして処理し、内容をエンコードし直す。
              // これまでどおり、書かれたままの形で出力する
              if (/^data:/i.test(url)) {
                return false
              }

              return true
            },
          },
          sourceMap: !PRODUCTION,
          modules: modulesOptions,
        },
      }
    },

    postcss: (options = {}) => {
      const {
        plugins,
        overrideBrowserslist = supportedBrowsers,
        ...postcssOpts
      } = options

      return {
        loader: require.resolve(`postcss-loader`),
        options: {
          execute: false,
          sourceMap: !PRODUCTION,
          // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
          postcssOptions: (loaderContext: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let postCSSPlugins: Array<PostCSSPlugin> = []
            if (plugins) {
              postCSSPlugins =
                typeof plugins === `function` ? plugins(loaderContext) : plugins
            }

            const autoprefixerPlugin = autoprefixer({
              overrideBrowserslist,
              flexbox: `no-2009`,
              ...((
                postCSSPlugins.find(
                  plugin => plugin.postcssPlugin === `autoprefixer`
                ) as unknown as autoprefixer.ExportedAPI
              )?.options ?? {}),
            })

            postCSSPlugins.unshift(autoprefixerPlugin)
            postCSSPlugins.unshift(flexbugs)

            return {
              plugins: postCSSPlugins,
              ...postcssOpts,
            }
          },
        },
      }
    },

    file: (options = {}) => {
      return {
        loader: require.resolve(`file-loader`),
        options: {
          ...fileLoaderCommonOptions,
          ...options,
        },
      }
    },

    url: (options = {}) => {
      return {
        loader: require.resolve(`url-loader`),
        options: {
          limit: 10000,
          ...fileLoaderCommonOptions,
          fallback: require.resolve(`file-loader`),
          ...options,
        },
      }
    },

    js: options => {
      return {
        options: {
          stage,
          reactRuntime: config.jsxRuntime,
          reactImportSource: config.jsxImportSource,
          cacheDirectory: path.join(
            program.directory,
            `.cache`,
            `webpack`,
            `babel`
          ),
          ...options,
          rootDir: program.directory,
        },
        loader: require.resolve(`./babel-loader`),
      }
    },

    dependencies: options => {
      return {
        options: {
          cacheDirectory: path.join(
            program.directory,
            `.cache`,
            `webpack`,
            `babel`
          ),
          ...options,
        },
        loader: require.resolve(`babel-loader`),
      }
    },
  }

  /**
   * ルール
   */
  const rules = {} as IRuleUtils

  /**
   * babel による JavaScript のローダー。ユーザー側のコードと、
   * `gatsby` に依存するパッケージを含む
   */
  {
    const js = ({
      modulesThatUseGatsby = [],
      ...options
    }: {
      modulesThatUseGatsby?: Array<IModuleThatUseGatsby>
    } = {}): RuleSetRule => {
      return {
        test: /\.(js|mjs|jsx|ts|tsx)$/,
        include: (modulePath: string): boolean => {
          // node_modules から来たものでなければ、ソースファイルとして扱う。
          if (!vendorRegex.test(modulePath)) {
            return true
          }

          // モジュールが Gatsby を依存として使っている場合は、
          // クエリを抽出できるように src として扱いたい
          return modulesThatUseGatsby.some(module =>
            modulePath.includes(module.path)
          )
        },
        type: `javascript/auto`,
        use: ({ resourceQuery, issuer }): Array<RuleSetUseItem> => [
          // JS の import が async-requires から来ている場合は、ページコンポーネント用であると仮定する。
          // `issuer` を使うことで、このケースのために async-requires を変更せずに済む。
          //
          // 将来 async-requires に他の import が追加された場合は、ストアの中のページコンポーネントに
          // クエリパラメーターを付け、ここで `resourceQuery` と照合するという方法もある。
          //
          // その場合、追加したクエリパラメーターによる不一致を避けるために、`static-query-mapper` の
          // `doesModuleMatchResourcePath` を、resource ではなくモジュールの `resourceResolveData.path` と
          // 照合するように調整する必要がある。他の調整も必要になるかもしれない。
          loaders.js({
            ...options,
            configFile: true,
            compact: PRODUCTION,
            isPageTemplate: /async-requires/.test(issuer),
            resourceQuery,
          }),
        ],
      }
    }
    rules.js = js
  }

  /**
   * babel による node_modules の JavaScript のローダー
   * babel のトランスパイルを速くするために、core-js と babel-runtime を除外する
   * Gatsby を使うモジュールは、`rules.js` がすでにトランスパイルしているので除外する
   */
  {
    const dependencies = ({
      modulesThatUseGatsby = [],
    }: {
      modulesThatUseGatsby?: Array<IModuleThatUseGatsby>
    } = {}): RuleSetRule => {
      const jsOptions = {
        babelrc: false,
        configFile: false,
        compact: false,
        presets: [
          [
            require.resolve(`babel-preset-gatsby/dependencies`),
            {
              stage,
            },
          ],
        ],
        // パッケージの中でエラーが起きた場合、コンパイルされたことが
        // 原因である可能性がある。そのため、ブラウザーのデバッガーに
        // 元のコードを表示させたくない。代わりに、実際に評価されている
        // コードのほうがずっと役に立つ。
        sourceMaps: false,

        cacheIdentifier: JSON.stringify({
          browsersList: supportedBrowsers,
          gatsbyPreset: require(`babel-preset-gatsby/package.json`).version,
        }),
      }

      // TODO V3 で削除する
      // ポリフィルすべきでないと分かっているベンダーの一覧（core-js を entry に設定すべきだったが、そうしなかったので、こうする必要がある）
      const VENDORS_TO_NOT_POLYFILL = [
        `@babel[\\\\/]runtime`,
        `@mikaelkristiansson[\\\\/]domready`,
        `@reach[\\\\/]router`,
        `babel-preset-gatsby`,
        `core-js`,
        `dom-helpers`,
        `gatsby-legacy-polyfills`,
        `gatsby-link`,
        `gatsby-script`,
        `gatsby-react-router-scroll`,
        `tiny-invariant`,
        `lodash`,
        `mitt`,
        `prop-types`,
        `react-dom`,
        `react`,
        `regenerator-runtime`,
        `scheduler`,
        `scroll-behavior`,
        `shallow-compare`,
        `warning`,
        `webpack`,
      ]
      const doNotPolyfillRegex = new RegExp(
        `[\\\\/]node_modules[\\\\/](${VENDORS_TO_NOT_POLYFILL.join(
          `|`
        )})[\\\\/]`
      )

      return {
        test: /\.(js|mjs)$/,
        exclude: (modulePath: string): boolean => {
          // 依存がユーザー側のコードであれば除外する
          if (!vendorRegex.test(modulePath)) {
            return true
          }

          // 依存が Gatsby を使っていれば除外する
          if (
            modulesThatUseGatsby.some(module =>
              modulePath.includes(module.path)
            )
          ) {
            return true
          }

          return doNotPolyfillRegex.test(modulePath)
        },
        type: `javascript/auto`,
        use: [loaders.dependencies(jsOptions)],
      }
    }
    rules.dependencies = dependencies
  }

  rules.yaml = (): RuleSetRule => {
    return {
      test: /\.ya?ml$/,
      type: `json`,
      use: [loaders.yaml()],
    }
  }

  /**
   * フォントのローダー
   */
  rules.fonts = (): RuleSetRule => {
    return {
      use: [loaders.url()],
      test: /\.(eot|otf|ttf|woff(2)?)(\?.*)?$/,
    }
  }

  /**
   * 画像のアセットを読み込む。サイズのしきい値を下回る場合は、
   * data URI でインライン化する
   */
  rules.images = (): RuleSetRule => {
    return {
      use: [loaders.url()],
      test: /\.(ico|svg|jpg|jpeg|png|gif|webp|avif)(\?.*)?$/,
    }
  }

  /**
   * 音声と動画を読み込む。サイズのしきい値を下回る場合は、
   * data URI でインライン化する
   */
  rules.media = (): RuleSetRule => {
    return {
      use: [loaders.url()],
      test: /\.(mp4|webm|ogv|wav|mp3|m4a|aac|oga|flac)$/,
    }
  }

  /**
   * インライン化せずにアセットを読み込む
   */
  rules.miscAssets = (): RuleSetRule => {
    return {
      use: [loaders.file()],
      test: /\.pdf$/,
    }
  }

  /**
   * CSS の style ローダー。
   */
  {
    const css: IRuleUtils[`css`] = (options = {}): RuleSetRule => {
      const { browsers, ...restOptions } = options
      const use = [
        !isSSR && loaders.miniCssExtract(restOptions),
        loaders.css({ ...restOptions, importLoaders: 1 }),
        loaders.postcss({ browsers }),
      ].filter(Boolean) as RuleSetRule[`use`]

      return {
        use,
        test: /\.css$/,
      }
    }

    /**
     * CSS の style ローダー。node_modules は _除外する_。
     */
    css.internal = makeInternalOnly(css)
    css.external = makeExternalOnly(css)

    const cssModules: IRuleUtils[`cssModules`] = (options): RuleSetRule => {
      const rule = css({ ...options, modules: true })
      delete rule.exclude
      rule.test = /\.module\.css$/
      return rule
    }

    rules.css = css
    rules.cssModules = cssModules
  }

  /**
   * PostCSS のローダー。
   */
  {
    const postcss: ContextualRuleFactory = (options): RuleSetRule => {
      return {
        test: /\.css$/,
        use: [loaders.css({ importLoaders: 1 }), loaders.postcss(options)],
      }
    }

    /**
     * PostCSS のローダー。node_modules は _除外する_。
     */
    postcss.internal = makeInternalOnly(postcss)
    postcss.external = makeExternalOnly(postcss)
    rules.postcss = postcss
  }
  /**
   * rules を IRuleUtils にキャストする
   */
  /**
   * プラグイン
   */
  const plugins = { ...builtinPlugins } as PluginUtils

  plugins.minifyJs = ({
    terserOptions,
    ...options
  }: {
    terserOptions?: TerserOptions
  } = {}): WebpackPluginInstance =>
    new TerserPlugin({
      exclude: /\.min\.js/,
      terserOptions: {
        ie8: false,
        mangle: {
          safari10: true,
        },
        parse: {
          ecma: 5,
        },
        compress: {
          ecma: 5,
        },
        output: {
          ecma: 5,
        },
        ...terserOptions,
      },
      parallel: Math.max(1, cpuCoreCount() - 1),
      ...options,
    })

  plugins.minifyCss = (
    options = {
      minimizerOptions: {
        preset: [
          `default`,
          {
            svgo: {
              full: true,
              plugins: [
                // 破壊的になりうるプラグインは取り除いた - https://github.com/gatsbyjs/gatsby/issues/15629 を参照
                // 正しい設定形式を使い、特定の引数が必要なプラグインを取り除く - https://github.com/gatsbyjs/gatsby/issues/31619 を参照
                // デフォルトのプラグインとそのデフォルト値の一覧: https://github.com/svg/svgo#built-in-plugins
                // 最終更新 2021-08-17
                // svgo 3 と 4 で名前が変わったプラグイン（`cleanupIDs` と `removeScriptElement`）は、新しい名前にしている
                `cleanupAttrs`,
                `cleanupEnableBackground`,
                `cleanupIds`,
                `cleanupListOfValues`, // デフォルト: 無効
                `cleanupNumericValues`,
                `collapseGroups`,
                `convertColors`,
                `convertPathData`,
                `convertStyleToAttrs`, // デフォルト: 無効
                `convertTransform`,
                `inlineStyles`,
                `mergePaths`,
                `minifyStyles`,
                `moveElemsAttrsToGroup`,
                `moveGroupAttrsToElems`,
                `prefixIds`, // デフォルト: 無効
                `removeComments`,
                `removeDesc`,
                `removeDoctype`,
                `removeEditorsNSData`,
                `removeEmptyAttrs`,
                `removeEmptyContainers`,
                `removeEmptyText`,
                `removeHiddenElems`,
                `removeMetadata`,
                `removeNonInheritableGroupAttrs`,
                `removeRasterImages`, // デフォルト: 無効
                `removeScripts`, // デフォルト: 無効
                `removeStyleElement`, // デフォルト: 無効
                `removeTitle`,
                `removeUnknownsAndDefaults`,
                `removeUnusedNS`,
                `removeUselessDefs`,
                `removeUselessStrokeAndFill`,
                `removeXMLProcInst`,
                `reusePaths`, // デフォルト: 無効
                `sortAttrs`, // デフォルト: 無効
              ],
            },
          },
        ],
      },
    }
  ): CssMinimizerPlugin =>
    new CssMinimizerPlugin({
      parallel: Math.max(1, cpuCoreCount() - 1),
      ...options,
    })

  plugins.fastRefresh = ({ modulesThatUseGatsby }): WebpackPluginInstance => {
    const regExpToHack = /node_modules/
    regExpToHack.test = (modulePath: string): boolean => {
      // node_modules から来たものでなければ、ソースファイルとして扱う。
      if (!vendorRegex.test(modulePath)) {
        return false
      }

      // モジュールが Gatsby を依存として使っている場合は、
      // シャドーイングのために src として扱いたい
      return !modulesThatUseGatsby.some(module =>
        modulePath.includes(module.path)
      )
    }

    return new ReactRefreshWebpackPlugin({
      overlay: {
        sockIntegration: `whm`,
        module: path.join(__dirname, `fast-refresh-module`),
      },
      // これは少しハック的である。exclude は、文字列、正規表現、またはそれらの配列を期待する
      // そこで、.test メソッドを上書きした正規表現を渡して、
      // ReactRefreshWebpackPlugin をだましている
      exclude: regExpToHack,
    })
  }

  plugins.extractText = (options: any): WebpackPluginInstance =>
    new MiniCssExtractPlugin({
      ...options,
    })

  plugins.moment = (): WebpackPluginInstance =>
    plugins.ignore({ resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/ })

  plugins.extractStats = (): GatsbyWebpackStatsExtractor =>
    new GatsbyWebpackStatsExtractor(publicPath)

  // TODO: v5 で削除する
  plugins.eslintGraphqlSchemaReload = (): null => null

  plugins.virtualModules = (): GatsbyWebpackVirtualModules =>
    new GatsbyWebpackVirtualModules()

  plugins.eslint = (): WebpackPluginInstance => {
    const options = {
      extensions: [`js`, `jsx`],
      exclude: [
        `/node_modules/`,
        `/bower_components/`,
        VIRTUAL_MODULES_BASE_PATH,
      ],
      ...eslintConfig(config.jsxRuntime === `automatic`),
    }
    // @ts-ignore
    return new ESLintPlugin(options)
  }

  plugins.eslintRequired = (): WebpackPluginInstance => {
    const options = {
      extensions: [`js`, `jsx`],
      exclude: [
        `/node_modules/`,
        `/bower_components/`,
        VIRTUAL_MODULES_BASE_PATH,
      ],
      ...eslintRequiredConfig,
    }
    // @ts-ignore
    return new ESLintPlugin(options)
  }

  return {
    loaders,
    rules,
    plugins,
  }
}
