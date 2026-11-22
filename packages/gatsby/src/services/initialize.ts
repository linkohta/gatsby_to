import _ from "lodash"
import { slash, isCI } from "gatsby-core-utils"
import * as fs from "fs-extra"
import { releaseAllMutexes } from "gatsby-core-utils/mutex"
import { md5, md5File } from "gatsby-core-utils"
import path from "path"
import glob from "globby"

import apiRunnerNode from "../utils/api-runner-node"
import { getBrowsersList } from "../utils/browserslist"
import { Store, AnyAction } from "redux"
import * as WorkerPool from "../utils/worker/pool"
import { startPluginRunner } from "../redux/plugin-runner"
import { store, emitter } from "../redux"
import reporter from "gatsby-cli/lib/reporter"
import { removeStaleJobs } from "../bootstrap/remove-stale-jobs"
import { IPluginInfoOptions } from "../bootstrap/load-plugins/types"
import { IGatsbyState, IStateProgram } from "../redux/types"
import { IBuildContext } from "./types"
import { loadConfig } from "../bootstrap/load-config"
import { loadPlugins } from "../bootstrap/load-plugins"
import type { InternalJob } from "../utils/jobs/types"
import type { IDataLayerContext } from "./../state-machines/data-layer/types"
import { enableNodeMutationsDetection } from "../utils/detect-node-mutations"
import { compileGatsbyFiles } from "../utils/parcel/compile-gatsby-files"
import { resolveModule } from "../utils/module-resolver"
import { writeGraphQLConfig } from "../utils/graphql-typegen/file-writes"
import { initAdapterManager } from "../utils/adapter/manager"
import type { IAdapterManager } from "../utils/adapter/types"

interface IPluginResolution {
  resolve: string
  options: IPluginInfoOptions
}

interface IPluginResolutionSSR extends IPluginResolution {
  name: string
}

// 環境変数 GATSBY_EXPERIMENTAL_FAST_DEV が設定されている場合は、
// DEV の実験的な変更をすべて有効にする（ただし開発中だけで、CI では有効にしない）。
if (
  process.env.gatsby_executing_command === `develop` &&
  process.env.GATSBY_EXPERIMENTAL_FAST_DEV &&
  !isCI() &&
  // ワーカーでは FAST_DEV の処理をスキップする。すべての環境変数は、メインプロセスで
  // すでに処理されてワーカーに渡される
  !process.env.GATSBY_WORKER_POOL_WORKER
) {
  process.env.GATSBY_EXPERIMENTAL_DEV_SSR = `true`
  process.env.PRESERVE_FILE_DOWNLOAD_CACHE = `true`

  reporter.info(`
Two fast dev experiments are enabled: SSR in develop and preserving file download cache.

Please give feedback on their respective umbrella issues!

- https://gatsby.dev/dev-ssr-feedback
- https://gatsby.dev/cache-clearing-feedback
  `)
}

// 未処理の Promise についてスタックトレースを表示する。
process.on(`unhandledRejection`, (reason: unknown) => {
  // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/33636
  reporter.panic((reason as Error) || `Unhandled rejection`)
})

// console.log を上書きして、ソースファイルと行番号を追加する。
// どこかに置いた console.log を見失ったときのデバッグに役立つ。
// それ以外のときはコメントアウトしたままにしておく。
// require(`../bootstrap/log-line-function`)

type WebhookBody = IDataLayerContext["webhookBody"]

export async function initialize({
  program: args,
  parentSpan,
}: IBuildContext): Promise<{
  store: Store<IGatsbyState, AnyAction>
  workerPool: WorkerPool.GatsbyWorkerPool
  webhookBody?: WebhookBody
  adapterManager?: IAdapterManager
}> {
  if (process.env.GATSBY_DISABLE_CACHE_PERSISTENCE) {
    reporter.info(
      `GATSBY_DISABLE_CACHE_PERSISTENCE is enabled. Cache won't be persisted. Next builds will not be able to reuse any work done by current session.`
    )
  }
  if (!args) {
    reporter.panic(`Missing program args`)
  }

  /* 少し経緯を説明する...
   * `gatsby develop` を実行すると、グローバルにインストールされた gatsby-cli が起動し、
   * Redux ストアをセットアップする（現在はここにログが保存される）。gatsby は、
   * プロジェクトにローカルでインストールされた gatsby-cli パッケージを node_modules で見つけると、
   * そちらに切り替える。このインスタンスは別の redux ストアを持つ。正しいストアが
   * 使われるようにする必要があり、そのために setStore を呼ぶ
   * (/packages/gatsby-cli/src/reporter/redux/index.js)
   *
   * この関数は次のことを行う
   * - グローバルの gatsby-cli からローカルの gatsby-cli へログをコピーする
   * - ストアをローカルのものに設定する（これにより、グローバルの gatsby-cli が以後に
   * dispatch するアクションは、ローカルの側で処理される）
   */
  if (args.setStore) {
    args.setStore(store)
  }

  if (reporter._registerAdditionalDiagnosticOutputHandler) {
    reporter._registerAdditionalDiagnosticOutputHandler(
      function logPendingJobs(): string {
        const outputs: Array<InternalJob> = []

        for (const [, { job }] of store.getState().jobsV2.incomplete) {
          outputs.push(job)
          if (outputs.length >= 5) {
            // 問題を追跡するには、完了していないジョブが 5 個あれば十分なはずである
            // これは、出力が埋め尽くされるのを抑えているだけである
            break
          }
        }

        return outputs.length
          ? `Unfinished jobs (showing ${outputs.length} of ${
              store.getState().jobsV2.incomplete.size
            } jobs total):\n\n` + JSON.stringify(outputs, null, 2)
          : ``
      }
    )
  }

  const directory = slash(args.directory)

  const program: IStateProgram = {
    ...args,
    extensions: [],
    browserslist: getBrowsersList(directory),
    // windows 環境向けに、プログラムのディレクトリのパスを修正する。
    directory,
  }

  store.dispatch({
    type: `SET_PROGRAM`,
    payload: program,
  })

  let activityForJobs

  emitter.on(`CREATE_JOB`, () => {
    if (!activityForJobs) {
      activityForJobs = reporter.phantomActivity(`Running jobs`)
      activityForJobs.start()
    }
  })

  const onEndJob = (): void => {
    if (activityForJobs && store.getState().jobs.active.length === 0) {
      activityForJobs.end()
      activityForJobs = null
    }
  }

  emitter.on(`END_JOB`, onEndJob)

  const siteDirectory = program.directory

  // ルートの gatsby ファイルをコンパイルする
  let activity = reporter.activityTimer(`compile gatsby files`)
  activity.start()
  await compileGatsbyFiles(siteDirectory)
  activity.end()

  // gatsby の config を読み込む
  activity = reporter.activityTimer(`load gatsby config`, {
    parentSpan,
  })
  activity.start()
  const config = await loadConfig({
    siteDirectory,
    processFlags: true,
  })
  activity.end()

  let adapterManager: IAdapterManager | undefined = undefined

  // アダプターは "gatsby build" のときにだけ初期化する
  if (process.env.gatsby_executing_command === `build`) {
    adapterManager = await initAdapterManager()
    await adapterManager.restoreCache()
  }

  // プラグインを読み込む
  activity = reporter.activityTimer(`load plugins`, {
    parentSpan,
  })
  activity.start()
  const flattenedPlugins = await loadPlugins(config, siteDirectory)
  activity.end()

  // GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR=false gatsby develop
  // とすると、query on demand のローディングインジケーターを無効にできる
  if (!process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR) {
    // GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR がまったく設定されていない場合は、
    // ローディングインジケーターを有効にする
    process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR = `true`
  }

  if (process.env.GATSBY_DETECT_NODE_MUTATIONS) {
    enableNodeMutationsDetection()
  }

  if (config && config.polyfill) {
    reporter.warn(
      `Support for custom Promise polyfills has been removed in Gatsby v2. We only support Babel 7's new automatic polyfilling behavior.`
    )
  }

  // コードベース全体で、GATSBY_QUERY_ON_DEMAND は、"gatsby develop" が実行中かどうかに応じて QoD の動作を条件付きで有効にするために使われている。CI でも、QoD はデフォルトで無効である。
  // GATSBY_ENABLE_QUERY_ON_DEMAND_IN_CI を使うと、CI で強制的に有効にできる。
  process.env.GATSBY_QUERY_ON_DEMAND = `true`
  if (process.env.gatsby_executing_command !== `develop`) {
    // 誰かがこの環境変数をグローバルに設定していた場合に備えて、
    // develop 以外ではこのフラグを決して有効にしない
    delete process.env.GATSBY_QUERY_ON_DEMAND
  } else if (isCI() && !process.env.GATSBY_ENABLE_QUERY_ON_DEMAND_IN_CI) {
    delete process.env.GATSBY_QUERY_ON_DEMAND
    reporter.verbose(
      `Query on Demand is disabled in CI by default. You can enable it by setting GATSBY_ENABLE_QUERY_ON_DEMAND_IN_CI env var.`
    )
  }

  // 古くなったジョブを実行する
  // @ts-ignore we'll need to fix redux typings https://redux.js.org/usage/usage-with-typescript
  store.dispatch(removeStaleJobs(store.getState().jobsV2))

  // ストアを監視し、アクションに基づいて Gatsby の API を呼び出す
  // プラグインランナーを起動する。
  startPluginRunner()

  // onPreInit
  activity = reporter.activityTimer(`onPreInit`, {
    parentSpan,
  })
  activity.start()
  await apiRunnerNode(`onPreInit`, { parentSpan: activity.span })
  activity.end()

  const lmdbCacheDirectoryName = `caches-lmdb`

  const cacheDirectory = `${program.directory}/.cache`
  const publicDirectory = `${program.directory}/public`
  const workerCacheDirectory = `${program.directory}/.cache/worker`
  const lmdbCacheDirectory = `${program.directory}/.cache/${lmdbCacheDirectoryName}`

  const publicDirExists = fs.existsSync(publicDirectory)
  const workerCacheDirExists = fs.existsSync(workerCacheDirectory)
  const lmdbCacheDirExists = fs.existsSync(lmdbCacheDirectory)

  // 現在の設定で使われるキャッシュファイルを確認する
  const cacheDirExists = lmdbCacheDirExists

  // ビルドで、public ディレクトリは存在するがキャッシュが存在しない場合は、以前のビルドの古いかもしれない
  // 成果物を片付ける必要がある（キャッシュがないので、成果物の追跡には頼れない）
  if (
    process.env.NODE_ENV === `production` &&
    publicDirExists &&
    !cacheDirExists
  ) {
    activity = reporter.activityTimer(
      `delete html and css files from previous builds`,
      {
        parentSpan,
      }
    )
    activity.start()
    const files = await glob(
      [
        `public/**/*.{html,css,mdb}`,
        `!public/page-data/**/*`,
        `!public/static`,
        `!public/static/**/*.{html,css}`,
      ],
      {
        cwd: program.directory,
      }
    )
    await Promise.all(files.map(file => fs.remove(file)))
    activity.end()
  }

  // メインプロセスとワーカーは、やり取りをするときに、redux の状態の一部を .cache/worker に保存する
  // ワーカーが誤って再利用しかねない古いファイルを取り除くために、このディレクトリを片付けるべきである
  if (workerCacheDirExists) {
    activity = reporter.activityTimer(
      `delete worker cache from previous builds`,
      {
        parentSpan,
      }
    )
    activity.start()
    await fs
      .remove(workerCacheDirectory)
      .catch(() => fs.emptyDir(workerCacheDirectory))
    activity.end()
  }

  activity = reporter.activityTimer(`initialize cache`, {
    parentSpan,
  })
  activity.start()
  // 前回の実行以降にプラグインが更新されたかを確認する。更新されていれば、
  // 前回の実行から変更があった可能性が高いので、
  // キャッシュを削除する。
  //
  // これは、インストールされているプラグインのすべてのバージョン番号、サイトの
  // package.json、gatsby-config.js、gatsby-node.js からハッシュを作ることで行う。
  // 最後の gatsby-node.js は重要である。多くの gatsby サイトが、独自のページの
  // slug の生成など、重要なロジックをそこに置いているためである。
  const pluginVersions = flattenedPlugins.map(p => p.version)
  // gatsby のバージョンも含めるべきである
  pluginVersions.push(require(`../../package.json`).version)
  const optionalFiles = [
    `${program.directory}/gatsby-config.js`,
    `${program.directory}/gatsby-node.js`,
    `${program.directory}/gatsby-config.ts`,
    `${program.directory}/gatsby-node.ts`,
  ] as Array<string>

  const state = store.getState()

  const hashes = await Promise.all(
    // 省略可能なファイルは必須ではないので、.catch() で無視する
    [md5File(`package.json`), state.config.trailingSlash as string].concat(
      optionalFiles.map(f => md5File(f).catch(() => ``))
    )
  )

  const pluginsHash = await md5(JSON.stringify(pluginVersions.concat(hashes)))

  const oldPluginsHash = state && state.status ? state.status.PLUGINS_HASH : ``

  // 何かが変わったかを確認する。変わっていれば、サイトの .cache
  // ディレクトリを削除し、レデューサーに自身を空にするよう伝える。
  //
  // また、ハッシュが存在しない場合も、何かがおかしいときに備えて
  // 念のため削除する。
  if (oldPluginsHash && pluginsHash !== oldPluginsHash) {
    reporter.info(reporter.stripIndent`
      One or more of your plugins have changed since the last time you ran Gatsby. As
      a precaution, we're deleting your site's cache to ensure there's no stale data.
    `)
  }

  // develop では、この時点で .cache ディレクトリが存在する
  // そのため、ヒューリスティックとして .cache/json または .cache/caches-lmdb を確認する（期待されるファイルであれば何でもよい）
  const cacheIsCorrupt = cacheDirExists && !publicDirExists
  if (cacheIsCorrupt) {
    reporter.info(reporter.stripIndent`
      We've detected that the Gatsby cache is incomplete (the .cache directory exists
      but the public directory does not). As a precaution, we're deleting your site's
      cache to ensure there's no stale data.
    `)
  }

  if (!oldPluginsHash || pluginsHash !== oldPluginsHash || cacheIsCorrupt) {
    try {
      // パフォーマンスへの影響をテストできるまで、案内はコメントアウトしておく
      //
      // let sourceFileSystemVersion = flattenedPlugins.find(
      // plugin => plugin.name === `gatsby-source-filesystem`
      // )?.version

      // // The site might be using a plugin which uses "createRemoteFileNode" but
      // // doesn't have gatsby-source-filesystem in their gatsby-config.js. So lets
      // // also try requiring it.
      // if (!sourceFileSystemVersion) {
      // try {
      // sourceFileSystemVersion = require(`gatsby-source-filesystem/package.json`)
      // ?.version
      // } catch {
      // // ignore require errors
      // }
      // }
      // } else if (
      // sourceFileSystemVersion &&
      // semver.lt(sourceFileSystemVersion, `2.9.0`)
      // ) {
      // // If the site has more than 50 downloaded files in it, tell them
      // // how to save time.
      // try {
      // // Divide by two as the directory as both cache files + the actual downloaded files so
      // // two results / downloaded file.
      // const filesCount =
      // (await fs.readdir(`.cache/caches/gatsby-source-filesystem`))
      // .length / 2
      // if (filesCount > 50) {
      // reporter.info(stripIndent`\n\n

      // Your local development experience is about to get better, faster, and stronger!

      // Your friendly Gatsby maintainers detected your site downloads quite a few files and that we're about to delete all ${Math.round(
      // filesCount
      // )} of them 😅. We're working right now to make our caching smarter which means we won't delete your downloaded files any more.

      // If you're interested in trialing the new caching behavior *today* — which should make your local development environment faster, go ahead and enable the PRESERVE_FILE_DOWNLOAD_CACHE flag and run your develop server again.

      // To do so, add to your gatsby-config.js:

      // flags: {
      // preserve_file_download_cache: true,
      // }

      // visit the umbrella issue to learn more: https://github.com/gatsbyjs/gatsby/discussions/28331
      // `)
      // }
      // } catch {
      // // ignore errors (mostly will just be directory not found).
      // }
      // }

      const deleteGlobs = [
        // デフォルトでは、すべてのファイルとサブディレクトリを削除する
        `.cache/**`,
        `.cache/data/**`,
        `!.cache/data/gatsby-core-utils/**`,
        `!.cache/compiled`,
        // webpack を追加する
        `!.cache/webpack`,
        `!.cache/adapters`,
      ]

      if (process.env.GATSBY_EXPERIMENTAL_PRESERVE_FILE_DOWNLOAD_CACHE) {
        // caches ディレクトリが削除されないようにし、すべてのサブディレクトリを追加するが、
        // gatsby-source-filesystem は取り除く
        deleteGlobs.push(`!.cache/caches`)
        deleteGlobs.push(`.cache/caches/*`)
        deleteGlobs.push(`!.cache/caches/gatsby-source-filesystem`)
      }

      const files = await glob(deleteGlobs, {
        cwd: program.directory,
      })

      await Promise.all(files.map(file => fs.remove(file)))
    } catch (e) {
      reporter.error(`Failed to remove .cache files.`, e)
    }
    // レデューサーにデータを削除するよう伝える（ストアはすでに
    // ファイルシステムのキャッシュから読み込まれている）。
    store.dispatch({
      type: `DELETE_CACHE`,
      cacheIsCorrupt,
    })

    // 以前のミューテックスがすべて解放されているようにする
    await releaseAllMutexes()
  }

  // 新しいプラグインのハッシュでストアを更新する。
  store.dispatch({
    type: `UPDATE_PLUGINS_HASH`,
    payload: pluginsHash,
  })

  // .cache ディレクトリが安全であることが分かったので、キャッシュの
  // ディレクトリを初期化する。
  await fs.ensureDir(cacheDirectory)

  // public/static ディレクトリが存在するようにする
  await fs.ensureDir(`${publicDirectory}/static`)

  // キャッシュが初期化されたら、プラグインを初期化する
  await apiRunnerNode(`onPluginInit`, {
    parentSpan: activity.span,
  })

  activity.end()

  activity = reporter.activityTimer(`copy gatsby files`, {
    parentSpan,
  })

  activity.start()

  const srcDir = `${__dirname}/../../cache-dir`
  const siteDir = cacheDirectory

  try {
    await fs.copy(srcDir, siteDir, {
      overwrite: true,
    })
    await fs.ensureDir(`${cacheDirectory}/${lmdbCacheDirectoryName}`)

    // .cache/fragments が存在し、空であるようにする。フラグメントは、実行のたびに
    // データに応じて追加したい。フラグメントを追加できるのは、それが依存する
    // スキーマの作成に使われるデータが利用できる場合だけだからである。
    await fs.emptyDir(`${cacheDirectory}/fragments`)
  } catch (err) {
    reporter.panic(`Unable to copy site files to .cache`, err)
  }

  // gatsby-browser と gatsby-ssr を実装しているプラグインを探し、
  // それらのための api-runner を書き出す。
  const hasAPIFile = (env, plugin): string | undefined => {
    // プラグインローダーが、このプラグインの SSR API を無効にしている。通常は、
    // 一度しか実装できない API が複数実装されていることが原因である
    if (env === `ssr` && plugin.skipSSR === true) return undefined

    const envAPIs = plugin[`${env}APIs`]

    // gatsby-browser.js ファイルが存在する場合は、常に含める。グローバルな
    // スタイルやその他のグローバルな import を置くのに便利な場所だからである。
    try {
      if (env === `browser`) {
        const modulePath = path.join(plugin.resolve, `gatsby-${env}`)
        return slash(resolveModule(modulePath) as string)
      }
    } catch (e) {
      // 無視する
    }

    if (envAPIs && Array.isArray(envAPIs) && envAPIs.length > 0) {
      const modulePath = path.join(plugin.resolve, `gatsby-${env}`)
      return slash(resolveModule(modulePath) as string)
    }
    return undefined
  }

  const isResolved = (plugin): plugin is IPluginResolution => !!plugin.resolve
  const isResolvedSSR = (plugin): plugin is IPluginResolutionSSR =>
    !!plugin.resolve

  const ssrPlugins: Array<IPluginResolutionSSR> = flattenedPlugins
    .map(plugin => {
      return {
        name: plugin.name,
        resolve: hasAPIFile(`ssr`, plugin),
        options: plugin.pluginOptions,
      }
    })
    .filter(isResolvedSSR)

  const browserPlugins: Array<IPluginResolution> = flattenedPlugins
    .map(plugin => {
      return {
        resolve: hasAPIFile(`browser`, plugin),
        options: plugin.pluginOptions,
      }
    })
    .filter(isResolved)

  const browserPluginsRequires = browserPlugins
    .map(plugin => {
      // ディレクトリが変わっても contenthash が同じになるように、相対的な import のパスが必要である
      const relativePluginPath = path.relative(siteDir, plugin.resolve)
      return `{
      plugin: require('${slash(relativePluginPath)}'),
      options: ${JSON.stringify(plugin.options)},
    }`
    })
    .join(`,`)

  const browserAPIRunner = `module.exports = [${browserPluginsRequires}]\n`

  let sSRAPIRunner = ``

  try {
    sSRAPIRunner = fs.readFileSync(`${siteDir}/api-runner-ssr.js`, `utf-8`)
  } catch (err) {
    reporter.panic(`Failed to read ${siteDir}/api-runner-ssr.js`, err)
  }

  const ssrPluginsRequires = ssrPlugins
    .map(
      plugin =>
        `{
      name: '${plugin.name}',
      plugin: require('${plugin.resolve}'),
      options: ${JSON.stringify(plugin.options)},
    }`
    )
    .join(`,`)
  sSRAPIRunner = `var plugins = [${ssrPluginsRequires}]\n${sSRAPIRunner}`

  fs.writeFileSync(
    `${siteDir}/api-runner-browser-plugins.js`,
    browserAPIRunner,
    `utf-8`
  )
  fs.writeFileSync(`${siteDir}/api-runner-ssr.js`, sSRAPIRunner, `utf-8`)

  activity.end()
  /**
   * メインの bootstrap の処理を開始する。
   */

  // onPreBootstrap
  activity = reporter.activityTimer(`onPreBootstrap`, {
    parentSpan,
  })
  activity.start()
  await apiRunnerNode(`onPreBootstrap`, {
    parentSpan: activity.span,
  })
  activity.end()

  // 解決できる拡張子を集めて、program に付ける。
  const extensions = [`.mjs`, `.js`, `.jsx`, `.wasm`, `.json`]
  // これをアクションに変更し、プラグインが拡張子を追加するために
  // `onPreBootstrap` を実装するようにする。
  const apiResults = await apiRunnerNode(`resolvableExtensions`, {
    traceId: `initial-resolvableExtensions`,
    parentSpan,
  })

  store.dispatch({
    type: `SET_PROGRAM_EXTENSIONS`,
    payload: _.flattenDeep([extensions, apiResults]),
  })

  const workerPool = WorkerPool.create()

  if (state.config.graphqlTypegen) {
    // これは `gatsby develop` のときにだけ実行される
    if (process.env.gatsby_executing_command === `develop`) {
      writeGraphQLConfig(program)
    }
  }

  let initialWebhookBody: WebhookBody = undefined

  if (process.env.GATSBY_INITIAL_WEBHOOK_BODY) {
    try {
      initialWebhookBody = JSON.parse(process.env.GATSBY_INITIAL_WEBHOOK_BODY)
    } catch (e) {
      reporter.error(
        `Failed to parse GATSBY_INITIAL_WEBHOOK_BODY as JSON:\n"${e.message}"`
      )
    }
  }

  return {
    store,
    workerPool,
    webhookBody: initialWebhookBody,
    adapterManager,
  }
}
