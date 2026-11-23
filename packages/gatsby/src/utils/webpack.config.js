const crypto = require(`crypto`)
const fs = require(`fs-extra`)
const path = require(`path`)
const dotenv = require(`dotenv`)
const { CoreJSResolver } = require(`./webpack/plugins/corejs-resolver`)
const { CacheFolderResolver } = require(
  `./webpack/plugins/cache-folder-resolver`
)
const { store } = require(`../redux`)
const { actions } = require(`../redux/actions`)
const { getPublicPath } = require(`./get-public-path`)
const debug = require(`debug`)(`gatsby:webpack-config`)
const reporter = require(`gatsby-cli/lib/reporter`)
import { withBasePath, withTrailingSlash } from "./path"
import { getGatsbyDependents } from "./gatsby-dependents"
const apiRunnerNode = require(`./api-runner-node`)
import { createWebpackUtils } from "./webpack-utils"
import { hasLocalEslint } from "./local-eslint-config-finder"
import { getAbsolutePathForVirtualModule } from "./gatsby-webpack-virtual-modules"
import { StaticQueryMapper } from "./webpack/plugins/static-query-mapper"
import { ForceCssHMRForEdgeCases } from "./webpack/plugins/force-css-hmr-for-edge-cases"
import { WebpackLoggingPlugin } from "./webpack/plugins/webpack-logging"
import { hasES6ModuleSupport } from "./browserslist"
import { builtinModules } from "module"
import { shouldGenerateEngines } from "./engines-helpers"
import { ROUTES_DIRECTORY } from "../constants"
import { BabelConfigItemsCacheInvalidatorPlugin } from "./babel-loader"
import { PartialHydrationPlugin } from "./webpack/plugins/partial-hydration"
import { resolveJSFilepath } from "../bootstrap/resolve-js-file-path"

const FRAMEWORK_BUNDLES = [`react`, `react-dom`, `scheduler`, `prop-types`]

// この正規表現は、フレームワークのライブラリのネストしたコピーを無視し、それらが issuer と一緒にバンドルされるようにする
const FRAMEWORK_BUNDLES_REGEX = new RegExp(
  `(?<!node_modules.*)[\\\\/]node_modules[\\\\/](${FRAMEWORK_BUNDLES.join(
    `|`
  )})[\\\\/]`
)

// 4 つのステージ（モード）がある:
//   1) develop: `gatsby develop` コマンド用。ホットリロードと、ページへの CSS の注入を行う
//   2) develop-html: develop と同じだが、html レンダラー用に、babel の設定に react-hmre を含めない
//   3) build-javascript: 本番用の JS と CSS のチャンクをビルドする
//   4) build-html: すべての HTML ファイルをビルドする

module.exports = async (
  program,
  directory,
  suppliedStage,
  port,
  { parentSpan } = {}
) => {
  let fastRefreshPlugin
  const modulesThatUseGatsby = await getGatsbyDependents()
  const directoryPath = withBasePath(directory)

  // webpack の設定を生成する目的では、develop と develop-html のステージを
  // まとめて扱う。
  const stage = suppliedStage
  const { rules, loaders, plugins } = createWebpackUtils(stage, program)

  const { assetPrefix, pathPrefix, trailingSlash } = store.getState().config

  const publicPath = getPublicPath({ assetPrefix, pathPrefix, ...program })
  const isPartialHydrationEnabled =
    (process.env.GATSBY_PARTIAL_HYDRATION === `true` ||
      process.env.GATSBY_PARTIAL_HYDRATION === `1`) &&
    _CFLAGS_.GATSBY_MAJOR === `5`

  function processEnv(stage, defaultNodeEnv) {
    debug(`Building env for "${stage}"`)
    // node の env は DEVELOPMENT | PRODUCTION にすべきである。node の世界で一般的に使われているためである
    // この変数は webpack の中で使われる
    const nodeEnv = process.env.NODE_ENV || `${defaultNodeEnv}`
    // config の env は実行される環境に依存し、staging や production など何でもありうる
    // これにより、gatsby のファイルの中で、異なる .env の環境や条件を使い分けられる
    const configEnv = process.env.GATSBY_ACTIVE_ENV || nodeEnv
    const envFile = path.join(process.cwd(), `./.env.${configEnv}`)
    let parsed = {}
    try {
      parsed = dotenv.parse(fs.readFileSync(envFile, { encoding: `utf8` }))
    } catch (err) {
      if (err.code !== `ENOENT`) {
        reporter.error(
          `There was a problem processing the .env file (${envFile})`,
          err
        )
      }
    }

    const target =
      stage === `build-html` || stage === `develop-html` ? `node` : `web`

    const envObject = Object.keys(parsed).reduce((acc, key) => {
      acc[key] = JSON.stringify(parsed[key])
      return acc
    }, {})

    const gatsbyVarObject = Object.keys(process.env).reduce((acc, key) => {
      if (target === `node` || key.match(/^GATSBY_/)) {
        acc[key] = JSON.stringify(process.env[key])
      }
      return acc
    }, {})

    // gatsby の動作を壊さないように、NODE_ENV と PUBLIC_DIR の上書きは許可しない
    envObject.NODE_ENV = JSON.stringify(nodeEnv)
    envObject.PUBLIC_DIR = JSON.stringify(`${process.cwd()}/public`)
    envObject.BUILD_STAGE = JSON.stringify(stage)
    envObject.CYPRESS_SUPPORT = JSON.stringify(process.env.CYPRESS_SUPPORT)
    envObject.GATSBY_QUERY_ON_DEMAND = JSON.stringify(
      !!process.env.GATSBY_QUERY_ON_DEMAND
    )

    if (stage === `develop`) {
      envObject.GATSBY_SOCKET_IO_DEFAULT_TRANSPORT = JSON.stringify(
        process.env.GATSBY_SOCKET_IO_DEFAULT_TRANSPORT || `websocket`
      )
    }

    const mergedEnvVars = Object.assign(envObject, gatsbyVarObject)

    return Object.keys(mergedEnvVars).reduce(
      (acc, key) => {
        acc[`process.env.${key}`] = mergedEnvVars[key]
        return acc
      },
      {
        "process.env": `({})`,
      }
    )
  }

  debug(`Loading webpack config for stage "${stage}"`)
  function getOutput() {
    switch (stage) {
      case `develop`:
        return {
          path: directory,
          filename: `[name].js`,
          // 出力の中の、生成された require() に /* filename */ コメントを追加する。
          pathinfo: true,
          // ソースマップのエントリーが、ディスク上の元の場所を指すようにする（Windows では URL の形式にする）
          publicPath: process.env.GATSBY_WEBPACK_PUBLICPATH || `/`,
          devtoolModuleFilenameTemplate: info =>
            path.resolve(info.absoluteResourcePath).replace(/\\/g, `/`),
          // React のクロスオリジンエラーを避ける
          // https://reactjs.org/docs/cross-origin-errors.html を参照
          crossOriginLoading: `anonymous`,
        }
      case `build-html`:
      case `develop-html`:
        // ページを SSR するために必要なファイルを生成する。
        // 本番では不要なので、build-html.js が削除する。
        return {
          path: directoryPath(ROUTES_DIRECTORY),
          filename: `[name].js`,
          chunkFilename: `[name].js`,
          library: {
            type: `commonjs`,
          },
          publicPath: withTrailingSlash(publicPath),
        }
      case `build-javascript`:
        return {
          filename: `[name]-[contenthash].js`,
          chunkFilename: `[name]-[contenthash].js`,
          path: directoryPath(`public`),
          publicPath: withTrailingSlash(publicPath),
        }
      default:
        throw new Error(`The state requested ${stage} doesn't exist.`)
    }
  }

  function getEntry() {
    switch (stage) {
      case `develop`:
        return hasES6ModuleSupport(directory)
          ? {
              commons: [directoryPath(`.cache/app`)],
            }
          : {
              polyfill: directoryPath(`.cache/polyfill-entry`),
              commons: [directoryPath(`.cache/app`)],
            }
      case `develop-html`:
        return {
          "render-page": process.env.GATSBY_EXPERIMENTAL_DEV_SSR
            ? directoryPath(`.cache/ssr-develop-static-entry`)
            : directoryPath(`.cache/develop-static-entry`),
        }
      case `build-html`: {
        return {
          "render-page": directoryPath(`.cache/static-entry`),
        }
      }
      case `build-javascript`:
        return hasES6ModuleSupport(directory)
          ? {
              app: directoryPath(`.cache/production-app`),
            }
          : {
              polyfill: directoryPath(`.cache/polyfill-entry`),
              app: directoryPath(`.cache/production-app`),
            }
      default:
        throw new Error(`The state requested ${stage} doesn't exist.`)
    }
  }

  function getPlugins() {
    let configPlugins = [
      plugins.moment(),

      // いくつかのグローバル変数を追加する。NODE_ENV を production に設定し（React の
      // 最適化が有効になる）、リンクのプレフィックス（__PATH_PREFIX__）も設定する。
      plugins.define({
        ...processEnv(stage, `development`),
        __BASE_PATH__: JSON.stringify(program.prefixPaths ? pathPrefix : ``),
        __PATH_PREFIX__: JSON.stringify(program.prefixPaths ? publicPath : ``),
        __ASSET_PREFIX__: JSON.stringify(
          program.prefixPaths ? assetPrefix : ``
        ),
        __TRAILING_SLASH__: JSON.stringify(trailingSlash),
        // TODO ページへのアセットの渡し方を改善する
        BROWSER_ESM_ONLY: JSON.stringify(hasES6ModuleSupport(directory)),
        "global.hasPartialHydration": isPartialHydrationEnabled,
      }),

      plugins.virtualModules(),
      new BabelConfigItemsCacheInvalidatorPlugin(),
      process.env.GATSBY_WEBPACK_LOGGING?.split(`,`)?.includes(stage) &&
        new WebpackLoggingPlugin(program.directory, reporter, program.verbose),
    ].filter(Boolean)

    switch (stage) {
      case `develop`: {
        configPlugins = configPlugins
          .concat([
            (fastRefreshPlugin = plugins.fastRefresh({ modulesThatUseGatsby })),
            new ForceCssHMRForEdgeCases(),
            plugins.hotModuleReplacement(),
            plugins.noEmitOnErrors(),
            new StaticQueryMapper(store),
          ])
          .filter(Boolean)

        configPlugins.push(
          plugins.extractText({
            filename: `[name].css`,
            chunkFilename: `[id].css`,
          })
        )

        if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
          configPlugins.push(plugins.extractStats())
        }

        const isCustomEslint = hasLocalEslint(program.directory)

        // ローカルの eslint の設定がなければ、gatsby の設定を追加する
        if (!isCustomEslint) {
          configPlugins.push(plugins.eslint())
        }

        // ローカルの eslint の設定があっても、fast-refresh のルールを強制する
        if (isCustomEslint) {
          configPlugins.push(plugins.eslintRequired())
        }

        break
      }
      case `build-javascript`: {
        configPlugins = configPlugins
          .concat([
            plugins.extractText({
              filename: `[name].[contenthash].css`,
              chunkFilename: `[name].[contenthash].css`,
            }),
            // 名前付きの動的 import（つまりページコンポーネント）から、そのすべての
            // 非同期チャンクへの対応を表す stats オブジェクトを書き出す。
            plugins.extractStats(),
            new StaticQueryMapper(store),
            isPartialHydrationEnabled
              ? new PartialHydrationPlugin(
                  path.join(
                    directory,
                    `.cache`,
                    `partial-hydration`,
                    `manifest.json`
                  ),
                  reporter
                )
              : null,
          ])
          .filter(Boolean)
        break
      }
      case `develop-html`:
      case `build-html`: {
        // node 環境にグローバルな fetch を追加する
        configPlugins.push(
          plugins.provide({
            fetch: require.resolve(`node-fetch`),
            "global.fetch": require.resolve(`node-fetch`),
          })
        )
        break
      }
    }

    return configPlugins
  }

  function getDevtool() {
    switch (stage) {
      case `develop`:
        return `eval-cheap-module-source-map`
      // html のフェーズでは、通常の `source-map` を使う。
      // 行番号と列番号がより正確になるためである
      case `develop-html`:
      case `build-html`:
      case `build-javascript`:
        return `source-map`
      default:
        return false
    }
  }

  function getMode() {
    switch (stage) {
      case `develop`:
      case `develop-html`:
        return `development`
      case `build-javascript`:
      case `build-html`:
      default:
        return `production`
    }
  }

  function getModule() {
    // すべての env に共通の設定。
    // prettier-ignore
    let configRules = [
      // Webpack は、ESM モジュールを import するときに拡張子があることを期待する。仕様がそう定めているためである。
      // すべてのライブラリが対応しているわけではないので、その動作は強制しない
      // @see https://github.com/webpack/webpack/issues/11467
      {
        test: /\.mjs$/i,
        resolve: {
          byDependency: {
            esm: {
              fullySpecified: false,
            },
          },
        },
      },
      {
        test: /\.js$/i,
        descriptionData: {
          type: `module`,
        },
        resolve: {
          byDependency: {
            esm: {
              fullySpecified: false,
            },
          },
        },
      },
      rules.js({
        modulesThatUseGatsby,
      }),
      rules.yaml(),
      rules.fonts(),
      rules.images(),
      rules.media(),
      rules.miscAssets(),
    ]

    // TODO(v5): Gatsby 4 の公開の間しか役に立たないので削除する
    if (_CFLAGS_.GATSBY_MAJOR !== `5`) {
      configRules.push({
        test: require.resolve(`@gatsbyjs/reach-router/es/index`),
        type: `javascript/auto`,
        use: [
          {
            loader: require.resolve(
              `./reach-router-add-basecontext-export-loader`
            ),
          },
        ],
      })
    }

    // ビルドを高速化する 🏎️💨。node_modules のトランスパイルを含めるのは、javascript の本番ビルドのときだけである
    // TODO この動作を develop でも有効にする gatsby プラグインを作る（この機能を求める人がいる場合のみ）
    if (stage === `build-javascript` && !hasES6ModuleSupport(directory)) {
      configRules.push(
        rules.dependencies({
          modulesThatUseGatsby,
        })
      )
    }

    switch (stage) {
      case `develop`: {
        configRules = configRules.concat([
          {
            oneOf: [rules.cssModules(), rules.css()],
          },
        ])

        break
      }
      case `build-html`:
      case `develop-html`:
        // HTML をビルドするときは、CSS を一切扱わない。
        // 'null' ローダーは、'module not found' エラーを防ぐために使う。
        // 一方で、CSS modules のローダーは必要である。

        // prettier-ignore
        configRules = configRules.concat([
          {
            oneOf: [
              rules.cssModules(),
              {
                ...rules.css(),
                use: [loaders.null()],
              },
            ],
          },
        ])
        break

      case `build-javascript`:
        // JavaScript をビルドするときも CSS は一切扱わないが、
        // offline-plugin が CSS の中で参照されているさまざまなアセットを
        // 把握できるように、CSS の処理は必要である。
        //
        // JS が使うべき classNames を知るために、CSS Modules の処理も
        // 必要である。
        configRules = configRules.concat([
          {
            oneOf: [rules.cssModules(), rules.css()],
          },
        ])

        break
    }

    if (!isPartialHydrationEnabled) {
      configRules.push({
        test: /react-server-dom-webpack/,
        use: loaders.null(),
      })
    }

    return { rules: configRules }
  }

  function getPackageRoot(pkg) {
    return path.dirname(require.resolve(`${pkg}/package.json`))
  }

  function getResolve(stage) {
    const { program } = store.getState()
    const resolve = {
      // program の拡張子の一覧（'resolvableExtensions' API フックで
      // 生成されたもの）を使う。
      extensions: [...program.extensions],
      alias: {
        gatsby$: directoryPath(path.join(`.cache`, `gatsby-browser-entry.js`)),
        // 相対パスの import が使われることがあるので、モジュールの解決に
        // ディレクトリを使うことは必須である
        // 詳しくは https://stackoverflow.com/a/49455609/6420957 を参照
        "@babel/runtime": getPackageRoot(`@babel/runtime`),
        "@reach/router": getPackageRoot(`@gatsbyjs/reach-router`),
        "react-lifecycles-compat": directoryPath(
          `.cache/react-lifecycles-compat.js`
        ),
        "react-server-dom-webpack": getPackageRoot(`react-server-dom-webpack`),
        "@pmmmwh/react-refresh-webpack-plugin": getPackageRoot(
          `@pmmmwh/react-refresh-webpack-plugin`
        ),
        "socket.io-client": getPackageRoot(`socket.io-client`),
        "webpack-hot-middleware": getPackageRoot(
          `@gatsbyjs/webpack-hot-middleware`
        ),
        $virtual: getAbsolutePathForVirtualModule(`$virtual`),
      },
      plugins: [
        new CoreJSResolver(),
        new CacheFolderResolver(path.join(program.directory, `.cache`)),
      ],
    }

    const target =
      stage === `build-html` || stage === `develop-html` ? `node` : `web`
    if (target === `web`) {
      // TODO(v5): Gatsby 4 の公開の間しか役に立たないので削除する
      if (_CFLAGS_.GATSBY_MAJOR !== `5`) {
        resolve.alias[`@reach/router`] = path.join(
          getPackageRoot(`@gatsbyjs/reach-router`),
          `es`
        )
      }

      resolve.alias[`gatsby-core-utils/create-content-digest`] = directoryPath(
        `.cache/create-content-digest-browser-shim`
      )
    }

    if (stage === `build-javascript` && program.profile) {
      resolve.alias[`react-dom$`] = `react-dom/profiling`
      resolve.alias[`scheduler/tracing`] = `scheduler/tracing-profiling`
    }

    // 一部のパッケージが独自のバージョンを使うので、SSR では react のバージョンが複数になることがある。React は 1 つのバージョンで最もうまく動く。
    // react と react-dom を gatsby から解決することで、サイトの側のバージョンの react と react-dom が得られる。peerdependency として指定されているためである。
    //
    // webpack は最初に一致したものを選ぶので、これはプロファイリング用の resolve.alias より下に置く必要がある
    // @see https://github.com/gatsbyjs/gatsby/issues/31098
    resolve.alias[`react`] = getPackageRoot(`react`)
    resolve.alias[`react-dom`] = getPackageRoot(`react-dom`)

    return resolve
  }

  function getResolveLoader() {
    const root = [path.resolve(directory, `node_modules`)]

    const userLoaderDirectoryPath = path.resolve(directory, `loaders`)

    try {
      if (fs.statSync(userLoaderDirectoryPath).isDirectory()) {
        root.push(userLoaderDirectoryPath)
      }
    } catch (err) {
      debug(`Error resolving user loaders directory`, err)
    }

    return {
      modules: [...root, path.join(__dirname, `../loaders`), `node_modules`],
    }
  }

  const config = {
    name: stage,
    // context は、entry オプションを解決するための基準のディレクトリである。
    context: directory,
    entry: getEntry(),
    output: getOutput(),

    module: getModule(),
    plugins: getPlugins(),

    devtool: getDevtool(),
    // （今のところ）webpack の通常の出力をどこにも表示したくないので、
    // パフォーマンスのヒントを無効にする。
    performance: {
      hints: false,
    },
    mode: getMode(),

    resolveLoader: getResolveLoader(),
    resolve: getResolve(stage),
  }

  if (stage === `build-html` || stage === `develop-html`) {
    config.target = `node14.15`
  } else {
    config.target = [`web`, `es5`]
  }

  const isCssModule = module => module.type === `css/mini-extract`

  if (stage === `develop`) {
    config.optimization = {
      splitChunks: {
        chunks: `all`,
        cacheGroups: {
          default: false,
          defaultVendors: false,
          framework: {
            chunks: `all`,
            name: `framework`,
            test: FRAMEWORK_BUNDLES_REGEX,
            priority: 40,
            // webpack にこのチャンクを取り除かせない（このチャンクが commons チャンクの一部になるのを防ぐ）
            enforce: true,
          },
          // 遅延読み込みのコンポーネントが壊れないように、すべての css と遅延読み込みの css を 1 つのスタイルシートにまとめる
          // TODO css-modules は例外にする
          styles: {
            test(module) {
              return isCssModule(module)
            },

            name: `commons`,
            priority: 40,
            enforce: true,
          },
        },
      },
      minimize: false,
    }
  }

  if (stage === `build-html` || stage === `develop-html`) {
    config.optimization = {
      // TODO partial hydration のマニフェストを直す
      mangleExports: !isPartialHydrationEnabled,
      minimize: false,
    }

    if (stage === `build-html`) {
      config.optimization.splitChunks = {
        chunks: `async`,
        minSize: 20000,
        minRemainingSize: 0,
        minChunks: 1,
        maxAsyncRequests: 30,
        maxInitialRequests: 30,
        enforceSizeThreshold: 50000,
        cacheGroups: {
          defaultVendors: {
            test: /[\\/]node_modules[\\/]/,
            priority: -10,
            reuseExistingChunk: true,
          },
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true,
          },
        },
      }
    } else {
      config.optimization.splitChunks = {
        cacheGroups: {
          default: false,
          defaultVendors: false,
        },
      }
    }
  }

  if (stage === `build-javascript`) {
    const componentsCount = store.getState().components.size

    const splitChunks = {
      chunks: `all`,
      cacheGroups: {
        default: false,
        defaultVendors: false,
        framework: {
          chunks: `all`,
          name: `framework`,
          // 重要: ここで何かを変更する場合は、"gatsby-plugin-preact" も更新すること
          test: module => {
            // gatsby-plugin-image のようなパッケージは、"react-dom/server" から import することがある。react-dom-server を framework バンドルに含めたくはない。
            // rawRequest は次のようになる:
            // - "react-dom/server"
            // - "node_modules/react-dom/cjs/react-dom-server-legacy.browser.production.min.js"
            // 名前に "react-dom-server" を含むパッケージに一致しないように、"react-dom-server" の前に "/" を付ける
            if (
              module?.rawRequest === `react-dom/server` ||
              module?.rawRequest?.includes(`/react-dom-server`)
            ) {
              return false
            }

            return FRAMEWORK_BUNDLES_REGEX.test(module.nameForCondition())
          },
          priority: 40,
          // webpack にこのチャンクを取り除かせない（このチャンクが commons チャンクの一部になるのを防ぐ）
          enforce: true,
        },
        // node_modules のモジュールが 160kb より大きい場合は、それ専用のチャンクを作る
        lib: {
          test(module) {
            return (
              !isCssModule(module) &&
              module.size() > 160000 &&
              /node_modules[/\\]/.test(module.identifier())
            )
          },
          name(module) {
            const hash = crypto.createHash(`sha1`)
            if (!module.libIdent) {
              throw new Error(
                `Encountered unknown module type: ${module.type}. Please open an issue.`
              )
            }

            hash.update(module.libIdent({ context: program.directory }))

            return hash.digest(`hex`).substring(0, 8)
          },
          priority: 30,
          minChunks: 1,
          reuseExistingChunk: true,
        },
        commons: {
          name: `commons`,
          // チャンクがすべてのコンポーネントで使われている場合は、commons に入れる（少なくとも 2 つのコンポーネントが必要）
          minChunks: Math.max(componentsCount, 2),
          priority: 20,
        },
        // チャンクが 2 つ以上のコンポーネントで使われている場合は、別のチャンクを作る
        shared: {
          test(module, { chunkGraph }) {
            for (const chunk of chunkGraph.getModuleChunksIterable(module)) {
              if (chunk.canBeInitial()) {
                return false
              }
            }

            return !isCssModule(module)
          },
          name(module, chunks) {
            const hash = crypto
              .createHash(`sha1`)
              .update(chunks.reduce((acc, chunk) => acc + chunk.name, ``))
              .digest(`hex`)

            return hash
          },
          priority: 10,
          minChunks: 2,
          reuseExistingChunk: true,
        },

        // 遅延読み込みのコンポーネントが壊れないように、すべての css と遅延読み込みの css を 1 つのスタイルシートにまとめる
        // TODO css-modules は例外にする
        styles: {
          test(module) {
            return isCssModule(module)
          },

          name: `styles`,
          priority: 40,
          enforce: true,
        },
      },
      // ページは async-requires を通じて非同期に読み込むので、maxInitialRequests はページコンポーネントから派生したチャンクには効果がない。
      // webpack はデフォルトで maxAsyncRequests を 6 に設定しているが、場合によってはこれでは足りず、かえってバンドルサイズが膨れ上がる。
      // これを打ち消すために、maxAsyncRequests を Infinity に設定している。これは、以前に設定していた初期リクエスト 25 件を超える可能性があるが、
      // 残念ながら、これより良い解決策がない。
      maxAsyncRequests: Infinity,
      maxInitialRequests: 25,
      minSize: 20000,
    }

    config.optimization = {
      runtimeChunk: {
        name: `webpack-runtime`,
      },
      // TODO partial hydration のマニフェストを直す
      mangleExports: !isPartialHydrationEnabled,
      splitChunks,
      minimizer: [
        // TODO: このオプションは noMinimize にすべきかもしれない
        !program.noUglify &&
          plugins.minifyJs(
            program.profile
              ? {
                  terserOptions: {
                    keep_classnames: true,
                    keep_fnames: true,
                  },
                }
              : {}
          ),
        plugins.minifyCss(),
      ].filter(Boolean),
    }
  }

  if (stage === `build-html` || stage === `develop-html`) {
    // develop-html または build-html（エンジンを生成しない場合）のときは、react と react-dom を externals にする
    const shouldMarkPackagesAsExternal =
      stage === `develop-html` || !shouldGenerateEngines()

    // tracking = build-html（エンジンを生成しない場合）
    const shouldTrackBuiltins =
      stage === `build-html` && !shouldGenerateEngines()

    // node の内部モジュールをバンドルから取り除く
    // https://webpack.js.org/configuration/externals/#externalspresets
    config.externalsPresets = {
      // 組み込みモジュールを追跡していない場合にだけ使う（組み込みモジュールを追跡する場合は、独自のフォールバックが用意される）
      node: !shouldTrackBuiltins,
    }
    config.externals = []

    if (shouldMarkPackagesAsExternal) {
      // ビルド時間を節約するために externals にしたいパッケージ
      // https://github.com/gatsbyjs/gatsby/pull/14208#pullrequestreview-240178728
      // const externalList = [`common-tags`, `lodash`, `semver`, /^lodash\//]

      // ユーザーが用意するものなので externals にしたいパッケージ
      const userExternalList = [`react`, /^react-dom\//]

      const checkItem = (item, request) => {
        if (typeof item === `string` && item === request) {
          return true
        } else if (item instanceof RegExp && item.test(request)) {
          return true
        }

        return false
      }

      config.externals.push(function (
        { context, getResolve, request },
        callback
      ) {
        // config の webpack のエイリアスを解決できるようにする
        // react が preact-compat にエイリアスされている場合に役立つ
        // node の世界にいるので、commonjs を強制する
        const resolver = getResolve({
          dependencyType: `commonjs`,
        })

        // バンドルに含める必要のないユーザーのモジュール
        if (userExternalList.some(item => checkItem(item, request))) {
          // TODO preact でもこれが動くようにする方法を見つける

          resolver(context, request, (err, newRequest) => {
            if (err) {
              callback(err)
              return
            }

            callback(null, newRequest)
          })
          return
        }
        // TODO 再び有効にできるか調べる。現状では esm のせいでビルドが壊れる
        // バンドルに含める必要のないユーザーのモジュール
        // if (externalList.some(item => checkItem(item, request))) {
        //   resolver(context, request, (err, request) => {
        //     if (err) {
        //       callback(err)
        //       return
        //     }

        //     callback(null, `commonjs2 ${request}`)
        //   })
        //   return
        // }

        callback()
      })
    }

    if (shouldTrackBuiltins) {
      if (stage === `build-html`) {
        const builtinModulesToTrack = [
          `fs`,
          `http`,
          `http2`,
          `https`,
          `child_process`,
        ]
        const builtinsExternalsDictionary = builtinModules.reduce(
          (acc, builtinModule) => {
            if (builtinModulesToTrack.includes(builtinModule)) {
              const builtinModuleTracked = path.join(
                program.directory,
                `.cache`,
                `ssr-builtin-trackers`,
                builtinModule
              )
              acc[builtinModule] = `commonjs ${builtinModuleTracked}`
              acc[`node:${builtinModule}`] = `commonjs ${builtinModuleTracked}`
            } else {
              acc[builtinModule] = `commonjs ${builtinModule}`
              acc[`node:${builtinModule}`] = `commonjs ${builtinModule}`
            }
            return acc
          },
          {}
        )

        config.externals.unshift(builtinsExternalsDictionary)
      }
    }
  }

  if (stage === `develop`) {
    config.externals = {
      "socket.io-client": `io`,
    }
  }

  if (
    stage === `build-javascript` ||
    stage === `build-html` ||
    stage === `develop` ||
    stage === `develop-html`
  ) {
    const cacheLocation = path.join(
      program.directory,
      `.cache`,
      `webpack`,
      `stage-` + stage
    )
    const pluginsPathsPromises = store
      .getState()
      .flattenedPlugins.filter(plugin =>
        plugin.nodeAPIs.includes(`onCreateWebpackConfig`)
      )
      .map(
        async plugin =>
          plugin.resolvedCompiledGatsbyNode ??
          (await resolveJSFilepath({
            rootDir: plugin.resolve,
            filePath: path.join(plugin.resolve, `gatsby-node`),
          }))
      )
    const pluginsPaths = await Promise.all(pluginsPathsPromises)

    const cacheConfig = {
      type: `filesystem`,
      name: stage,
      cacheLocation,
      buildDependencies: {
        config: [__filename, ...pluginsPaths],
      },
    }

    config.cache = cacheConfig
  }

  store.dispatch(actions.replaceWebpackConfig(config))
  const getConfig = () => store.getState().webpack

  await apiRunnerNode(`onCreateWebpackConfig`, {
    getConfig,
    // いずれは build-html に統合するが、今のところは、これが SSR を動かす最も速い方法だった
    stage,
    rules,
    loaders,
    plugins,
    parentSpan,
  })

  if (fastRefreshPlugin) {
    // Fast refresh プラグインには、HMR のコードを注入するかどうかを決める
    // `include` オプションがある。どのモジュールに fast-refresh の HMR を追加するかを
    // 決めるときに、こちらの babel-loader を使うすべての独自のローダー
    // （.ts や .mdx など）が考慮されるようにする必要がある。
    const fastRefreshIncludes = []
    const babelLoaderLoc = require.resolve(`./babel-loader`)
    for (const rule of getConfig().module.rules) {
      if (!rule.use && !rule.loader) {
        continue
      }

      let use = rule.use

      if (typeof use === `function`) {
        use = rule.use({})
      }

      const ruleLoaders = Array.isArray(use)
        ? use.map(useEntry =>
            typeof useEntry === `string` ? useEntry : useEntry.loader
          )
        : [use?.loader ?? rule.loader]

      const hasBabelLoader = ruleLoaders.some(
        loader => loader === babelLoaderLoc
      )

      if (hasBabelLoader) {
        fastRefreshIncludes.push(rule.test)
      }
    }

    // fast refresh プラグインのデフォルトの include から始める
    const includeRegex = /\.([jt]sx?|flow)$/i
    includeRegex.test = modulePath => {
      // ローダーのルールの test がうまく動くように、
      // リクエストからクエリパラメーター（mdx-loader の ?type=component など）を取り除く
      const queryParamStartIndex = modulePath.indexOf(`?`)
      if (queryParamStartIndex !== -1) {
        modulePath = modulePath.slice(0, queryParamStartIndex)
      }

      return fastRefreshIncludes.some(re => re.test(modulePath))
    }

    fastRefreshPlugin.options.include = includeRegex
  }

  return getConfig()
}
