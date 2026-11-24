import fs from "fs-extra"
import { glob as globAsync } from "../../utils/glob"
import path from "path"
import webpack from "webpack"
import _ from "lodash"
import { getMatchPath, urlResolve } from "gatsby-core-utils"
import { CreateDevServerArgs, ParentSpanPluginArgs } from "gatsby"
import formatWebpackMessages from "react-dev-utils/formatWebpackMessages"
import dotenv from "dotenv"
import chokidar from "chokidar"
import { createGlobWatchFilter } from "gatsby-core-utils/watch-globs"
import { reportWebpackWarnings } from "../../utils/webpack-error-utils"
import { internalActions } from "../../redux/actions"
import { IGatsbyFunction } from "../../redux/types"
import { functionMiddlewares, FUNCTIONS_ROUTE } from "./middleware"
import mod from "module"

const isProductionEnv = process.env.gatsby_executing_command !== `develop`

interface IGlobPattern {
  /** この名前空間を所有するプラグイン **/
  pluginName: string
  /** 関数のルートパス **/
  rootPath: string
  /** glob パターン **/
  globPattern: string
  /** glob の除外パターン */
  ignorePattern: Array<string>
}

// 開発中は、関数がリクエストされたときにだけ遅延的にコンパイルする。
// ここでは、どの関数がリクエスト済みで「アクティブ」であるかを追跡する
const activeDevelopmentFunctions = new Set<IGatsbyFunction>()
let activeEntries = {}

async function ensureFunctionIsCompiled(
  functionObj: IGatsbyFunction,
  compiledFunctionsDir: string
): Promise<any> {
  // コンパイル済みの関数を stat する。存在すれば return する。
  let compiledFileExists = false
  try {
    compiledFileExists = !!(await fs.stat(functionObj.absoluteCompiledFilePath))
  } catch (e) {
    // 無視する
  }
  if (compiledFileExists) {
    return
  } else {
    // そうでなければ、ファイルを touch して webpack を再起動し、ファイルが
    // コンパイルされるのを監視する。
    const time = new Date()
    fs.utimesSync(functionObj.originalAbsoluteFilePath, time, time)
    await new Promise(resolve => {
      const watcher = chokidar
        // .cache 内のコンパイル済み関数のディレクトリのルートを監視する。chokidar は
        // まだ存在しないディレクトリ内のファイルを監視できないためである。
        .watch(compiledFunctionsDir)
        .on(`add`, async _path => {
          if (_path === functionObj.absoluteCompiledFilePath) {
            await watcher.close()

            resolve(null)
          }
        })
    })
  }
}

// glob、プラグイン名、ルートパスを持つ glob の型を作成する
const createGlobArray = (siteDirectoryPath, plugins): Array<IGlobPattern> => {
  const globs: Array<IGlobPattern> = []

  function globIgnorePatterns(
    root: string,
    pluginName?: string
  ): Array<string> {
    const nestedFolder = pluginName ? `/${pluginName}/**/` : `/**/`

    return [
      `${root}/src/api${nestedFolder}__tests__/**/*.+(js|ts)`, // Jest のテスト
      `${root}/src/api${nestedFolder}+(*.)+(spec|test).+(js|ts)`,
      `${root}/src/api${nestedFolder}+(*.)+(d).ts`, // .d.ts ファイル
    ]
  }

  // サイトのデフォルトの src/api ディレクトリを追加する。
  globs.push({
    globPattern: `${siteDirectoryPath}/src/api/**/*.{js,ts}`,
    ignorePattern: globIgnorePatterns(siteDirectoryPath),
    rootPath: path.join(siteDirectoryPath, `src/api`),
    pluginName: `default-site-plugin`,
  })

  // 各プラグインを追加する
  plugins.forEach(plugin => {
    // サイトの「デフォルト」プラグイン（つまり src ツリー）は、すでに
    // 監視しているので無視する。
    if (plugin.name === `default-site-plugin`) {
      return
    }
    // デフォルトで含めているプラグインは無視する。デフォルトの関数を
    // 同梱したくなることはまずないが、その場合は特別扱いで追加する。
    // それまでは、余分な FS の IO を避ける。
    if (plugin.resolve.includes(`internal-plugin`)) {
      return
    }
    if (plugin.resolve.includes(`gatsby-plugin-typescript`)) {
      return
    }
    if (plugin.resolve.includes(`gatsby-plugin-page-creator`)) {
      return
    }

    const glob = {
      globPattern: `${plugin.resolve}/src/api/${plugin.name}/**/*.{js,ts}`,
      ignorePattern: globIgnorePatterns(plugin.resolve, plugin.name),
      rootPath: path.join(plugin.resolve, `src/api`),
      pluginName: plugin.name,
    } as IGlobPattern
    globs.push(glob)
  })

  // 一意なパスだけを返す
  return _.union(globs)
}

const createWebpackConfig = async ({
  siteDirectoryPath,
  store,
  reporter,
}): Promise<webpack.Configuration> => {
  const compiledFunctionsDir = path.join(
    siteDirectoryPath,
    `.cache`,
    `functions`
  )

  const globs = createGlobArray(
    siteDirectoryPath,
    store.getState().flattenedPlugins
  )

  const seenFunctionIds = new Set<string>()
  // glob を実行し、相対パスと絶対パス、およびそれらがどのプラグインに
  // 属するかを持つオブジェクトを返す。
  const allFunctions = await Promise.all(
    globs.map(async (glob): Promise<Array<IGatsbyFunction>> => {
      const knownFunctions: Array<IGatsbyFunction> = []
      const files = await globAsync(glob.globPattern, {
        ignore: glob.ignorePattern,
      })
      files.map(file => {
        const originalAbsoluteFilePath = file
        const originalRelativeFilePath = path.relative(glob.rootPath, file)

        const { dir, name } = path.parse(originalRelativeFilePath)
        // コンパイル済みの関数はすべて js で終わるので、元の拡張子は無視する。
        const compiledFunctionName = path.join(dir, name + `.js`)
        const compiledPath = path.join(
          compiledFunctionsDir,
          compiledFunctionName
        )
        const finalName = urlResolve(dir, name === `index` ? `` : name)

        // functionId は英数字とダッシュだけで構成されるべきである
        const functionIdBase = _.kebabCase(compiledFunctionName).replace(
          /[^a-zA-Z0-9-]/g,
          `-`
        )

        let functionId = functionIdBase

        if (seenFunctionIds.has(functionId)) {
          let counter = 2
          do {
            functionId = `${functionIdBase}-${counter}`
            counter++
          } while (seenFunctionIds.has(functionId))
        }

        knownFunctions.push({
          functionRoute: finalName,
          pluginName: glob.pluginName,
          originalAbsoluteFilePath,
          originalRelativeFilePath,
          relativeCompiledFilePath: compiledFunctionName,
          absoluteCompiledFilePath: compiledPath,
          matchPath: getMatchPath(finalName),
          functionId,
        })
      })

      return knownFunctions
    })
  )

  // 関数をルート名でまとめ、デフォルトの functions ディレクトリの関数が
  // プラグインの実装を上書きできるようにする。
  // @ts-ignore - Seems like a TS bug: https://github.com/microsoft/TypeScript/issues/28010#issuecomment-713484584
  const knownFunctions = _.unionBy(...allFunctions, func => func.functionRoute)

  store.dispatch(internalActions.setFunctions(knownFunctions))

  // `gatsby serve` とプラグインが使うマニフェストを書き出す
  fs.writeFileSync(
    path.join(compiledFunctionsDir, `manifest.json`),
    JSON.stringify(knownFunctions, null, 4)
  )

  const {
    config: { pathPrefix },
    program,
  } = store.getState()

  // process.env.* と .env.* ファイルから環境変数を読み込む。
  // ロジックは webpack.config.js と共有している

  // node env は DEVELOPMENT | PRODUCTION であるべきである。Node の世界ではこれらが一般的に使われている
  const nodeEnv = process.env.NODE_ENV || `development`
  // config env は実行される環境に依存し、staging から production まで何にでもなりうる
  // これにより、異なる .env 環境を使ったり、gatsby のファイル内で条件を設定したりできる
  const configEnv = process.env.GATSBY_ACTIVE_ENV || nodeEnv
  const envFile = path.join(siteDirectoryPath, `./.env.${configEnv}`)
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

  const envObject = Object.keys(parsed).reduce(
    (acc, key) => {
      acc[key] = JSON.stringify(parsed[key])
      return acc
    },
    {} as Record<string, string>
  )

  const varsFromProcessEnv = Object.keys(process.env).reduce(
    (acc, key) => {
      acc[key] = JSON.stringify(process.env[key])
      return acc
    },
    {} as Record<string, string>
  )

  // gatsby の動作を壊さないよう、NODE_ENV と PUBLIC_DIR の上書きは許可しない
  envObject.NODE_ENV = JSON.stringify(nodeEnv)
  envObject.PUBLIC_DIR = JSON.stringify(`${siteDirectoryPath}/public`)

  const mergedEnvVars = Object.assign(envObject, varsFromProcessEnv)

  const processEnvVars = Object.keys(mergedEnvVars).reduce(
    (acc, key) => {
      acc[`process.env.${key}`] = mergedEnvVars[key]
      return acc
    },
    {
      "process.env": `({})`,
    }
  )

  const entries = {}

  const precompileDevFunctions =
    isProductionEnv ||
    process.env.GATSBY_PRECOMPILE_DEVELOP_FUNCTIONS === `true` ||
    process.env.GATSBY_PRECOMPILE_DEVELOP_FUNCTIONS === `1`

  const functionsList = precompileDevFunctions
    ? knownFunctions
    : activeDevelopmentFunctions

  functionsList.forEach(functionObj => {
    // 拡張子を除いたパスを取得する（ts のことも js のこともあるため）
    const parsedFile = path.parse(functionObj.originalRelativeFilePath)
    const compiledNameWithoutExtension = path.join(
      parsedFile.dir,
      parsedFile.name
    )

    let entryToTheFunction = functionObj.originalAbsoluteFilePath
    // ユーザー定義の関数を、matchPath と body の解析を処理する前処理でラップする
    // 詳細は api-function-webpack-loader.ts を参照
    entryToTheFunction += `?matchPath=` + (functionObj.matchPath ?? ``)
    entries[compiledNameWithoutExtension] = entryToTheFunction
  })

  activeEntries = entries

  const stage = isProductionEnv
    ? `functions-production`
    : `functions-development`

  const gatsbyPluginTSRequire = mod.createRequire(
    require.resolve(`gatsby-plugin-typescript`)
  )

  return {
    entry: entries,
    output: {
      path: compiledFunctionsDir,
      filename: `[name].js`,
      libraryTarget: `commonjs2`,
    },
    target: `node`,

    // ミニファイはコストが高く、サーバーレス関数ではそれほど役に立たない。
    optimization: {
      minimize: false,
    },

    // .ts で終わるファイルと、デフォルトの拡張子である .js、.json、.wasm を解決する
    resolve: {
      extensions: [`.ts`, `...`],
    },

    // webpack にキャッシュを .cache/webpack ディレクトリへ保存させる
    cache: {
      type: `filesystem`,
      name: stage,
      cacheLocation: path.join(
        siteDirectoryPath,
        `.cache`,
        `webpack`,
        `stage-` + stage
      ),
    },

    mode: isProductionEnv ? `production` : `development`,
    // watch: !isProductionEnv,
    module: {
      rules: [
        // webpack は、仕様に記述されているとおり、ESM モジュールを import するときに拡張子を期待する。
        // すべてのライブラリが対応しているわけではないので、この挙動は強制しない
        // @see https://github.com/webpack/webpack/issues/11467
        {
          test: /\.[tj]sx?$/,
          resourceQuery: /matchPath/,
          use: {
            loader: require.resolve(`./api-function-webpack-loader`),
          },
        },
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
          use: {
            loader: require.resolve(`babel-loader`),
            options: {
              presets: [
                gatsbyPluginTSRequire.resolve(`@babel/preset-typescript`),
              ],
            },
          },
        },
        {
          test: [/.js$/, /.ts$/],
          exclude: /node_modules/,
          use: {
            loader: require.resolve(`babel-loader`),
            options: {
              presets: [
                gatsbyPluginTSRequire.resolve(`@babel/preset-typescript`),
              ],
            },
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        PREFIX_TO_STRIP: JSON.stringify(
          program.prefixPaths ? pathPrefix?.replace(/(^\/+|\/+$)/g, ``) : ``
        ),
        ...processEnvVars,
      }),
      new webpack.IgnorePlugin({
        checkResource(resource): boolean {
          if (resource === `lmdb`) {
            reporter.warn(
              `LMDB and other modules with native dependencies are not supported in Gatsby Functions.\nIf you are importing utils from \`gatsby-core-utils\`, make sure to import from a specific module (for example \`gatsby-core-utils/create-content-digest\`).`
            )
            return true
          }
          return false
        },
      }),
    ],
  }
}

let isFirstBuild = true
export async function onPreBootstrap({
  reporter,
  store,
  parentSpan,
}: ParentSpanPluginArgs): Promise<void> {
  const activity = reporter.activityTimer(`Compiling Gatsby Functions`, {
    parentSpan,
  })
  activity.start()

  const {
    program: { directory: siteDirectoryPath },
  } = store.getState()

  const compiledFunctionsDir = path.join(
    siteDirectoryPath,
    `.cache`,
    `functions`
  )

  await fs.ensureDir(compiledFunctionsDir)
  await fs.emptyDir(compiledFunctionsDir)

  try {
    // 不格好だが、共有のコールバック関数から resolve/reject の関数に
    // アクセスできるようにする必要があるので、こうしている
    // eslint-disable-next-line
    await new Promise<any>(async (resolve, reject) => {
      const config = await createWebpackConfig({
        siteDirectoryPath,
        store,
        reporter,
      })

      function callback(err, stats?: webpack.Stats): void {
        const rawMessages = stats?.toJson({
          all: false,
          warnings: true,
          errors: true,
        })
        if (rawMessages?.warnings && rawMessages.warnings.length > 0) {
          reportWebpackWarnings(rawMessages.warnings, reporter)
        }

        if (err) return reject(err)
        const errors = stats?.compilation.errors || []

        // エラーがある場合、本番では reject し、開発ではコンソールに
        // 出力する。
        if (isProductionEnv) {
          if (errors.length > 0) return reject(errors)
        } else {
          const formatted = formatWebpackMessages({
            errors: rawMessages?.errors
              ? rawMessages.errors.map(e => e.message)
              : [],
            warnings: [],
          })
          reporter.error(formatted.errors)
        }

        // 開発では成功をログに出力する
        if (!isProductionEnv) {
          if (isFirstBuild) {
            isFirstBuild = false
          } else {
            reporter.success(`Re-building functions`)
          }
        }

        return resolve(null)
      }

      if (isProductionEnv) {
        webpack(config).run(callback)
      } else {
        // watch モードでは、呼び出し方が異なる
        let compiler = webpack(config).watch({}, callback)

        const globs = createGlobArray(
          siteDirectoryPath,
          store.getState().flattenedPlugins
        )

        // chokidar 4 以降は glob を監視できないので、glob を親フォルダーの監視と絞り込みに置き換える
        const watchFilter = createGlobWatchFilter()

        // env ファイルの変更を監視し、webpack のウォッチャーを再起動する。
        chokidar
          .watch(
            watchFilter.add([
              `${siteDirectoryPath}/.env*`,
              ...globs.map(glob => glob.globPattern),
            ]),
            { ignoreInitial: true, ignored: watchFilter.ignored }
          )
          .on(`all`, async (event, path) => {
            // glob を監視していたときは、フォルダーのイベントは届かなかった
            if (event === `addDir` || event === `unlinkDir`) {
              return
            }

            // すでに監視している関数については、API ディレクトリからの
            // 変更イベントを無視する。
            if (
              event === `change` &&
              Object.values(activeEntries).includes(path) &&
              path.includes(`/src/api/`)
            ) {
              return
            }

            reporter.log(
              `Restarting function watcher due to change to "${path}"`
            )

            // そうでなければ、ウォッチャーを再起動する
            compiler.close(async () => {
              const config = await createWebpackConfig({
                siteDirectoryPath,
                store,
                reporter,
              })
              compiler = webpack(config).watch({}, callback)
            })
          })
      }
    })
  } catch (error) {
    activity.panic({
      id: `11332`,
      error,
      context: {},
    })
  }

  activity.end()
}

export async function onCreateDevServer({
  reporter,
  app,
  store,
}: CreateDevServerArgs): Promise<void> {
  reporter.verbose(`Attaching functions to development server`)

  const {
    program: { directory: siteDirectoryPath },
  } = store.getState()

  const compiledFunctionsDir = path.join(
    siteDirectoryPath,
    `.cache`,
    `functions`
  )

  app.use(
    FUNCTIONS_ROUTE,
    ...functionMiddlewares({
      getFunctions(): Array<IGatsbyFunction> {
        const { functions }: { functions: Array<IGatsbyFunction> } =
          store.getState()
        return functions
      },
      async prepareFn(functionObj: IGatsbyFunction): Promise<void> {
        activeDevelopmentFunctions.add(functionObj)
        await ensureFunctionIsCompiled(functionObj, compiledFunctionsDir)
      },
      showDebugMessageInResponse: true,
    })
  )
}
