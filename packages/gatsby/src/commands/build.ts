import path from "path"
import report from "gatsby-cli/lib/reporter"
import fs from "fs-extra"
import {
  updateInternalSiteMetadata,
  isTruthy,
  uuid,
  cpuCoreCount,
} from "gatsby-core-utils"
import {
  buildRenderer,
  buildHTMLPagesAndDeleteStaleArtifacts,
  IBuildArgs,
} from "./build-html"
import { buildProductionBundle } from "./build-javascript"
import { bootstrap } from "../bootstrap"
import apiRunnerNode from "../utils/api-runner-node"
import { GraphQLRunner } from "../query/graphql-runner"
import { copyStaticDirs } from "../utils/get-static-dir"
import { initTracer, stopTracer } from "../utils/tracer"
import * as db from "../redux/save-state"
import { store } from "../redux"
import * as appDataUtil from "../utils/app-data"
import { flush as flushPendingPageDataWrites } from "../utils/page-data"
import {
  structureWebpackErrors,
  reportWebpackWarnings,
} from "../utils/webpack-error-utils"
import {
  userGetsSevenDayFeedback,
  userPassesFeedbackRequestHeuristic,
  showFeedbackRequest,
  showSevenDayFeedbackRequest,
} from "../utils/feedback"
import { actions } from "../redux/actions"
import { waitUntilAllJobsComplete } from "../utils/wait-until-jobs-complete"
import { Stage } from "./types"
import {
  calculateDirtyQueries,
  runStaticQueries,
  runPageQueries,
  runSliceQueries,
  writeOutRequires,
} from "../services"
import {
  markWebpackStatusAsPending,
  markWebpackStatusAsDone,
} from "../utils/webpack-status"
import { showExperimentNotices } from "../utils/show-experiment-notice"
import {
  mergeWorkerState,
  runQueriesInWorkersQueue,
} from "../utils/worker/pool"
import { createGraphqlEngineBundle } from "../schema/graphql-engine/bundle-webpack"
import {
  createPageSSRBundle,
  copyStaticQueriesToEngine,
} from "../utils/page-ssr-module/bundle-webpack"
import { shouldGenerateEngines } from "../utils/engines-helpers"
import reporter from "gatsby-cli/lib/reporter"
import {
  materializePageMode,
  getPageMode,
  preparePageTemplateConfigs,
} from "../utils/page-mode"
import { validateEnginesWithActivity } from "../utils/validate-engines"
import { constructConfigObject } from "../utils/gatsby-cloud-config"
import { waitUntilWorkerJobsAreComplete } from "../utils/jobs/worker-messaging"
import { getSSRChunkHashes } from "../utils/webpack/get-ssr-chunk-hashes"
import { writeTypeScriptTypes } from "../utils/graphql-typegen/ts-codegen"

module.exports = async function build(
  program: IBuildArgs,
  // Gatsby を実行している外部システムが属性を注入できるようにする
  externalTelemetryAttributes: Record<string, any>
): Promise<void> {
  // store なしで使うためのグローバルな gatsby オブジェクト
  global.__GATSBY = {
    buildId: uuid.v4(),
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    root: program!.directory,
  }

  if (isTruthy(process.env.VERBOSE)) {
    program.verbose = true
  }
  report.setVerbose(program.verbose)

  if (program.profile) {
    report.warn(
      `React Profiling is enabled. This can have a performance impact. See https://www.gatsbyjs.com/docs/profiling-site-performance-with-react-profiler/#performance-impact`
    )
  }

  report.verbose(`Running build in "${process.env.NODE_ENV}" environment`)

  await updateInternalSiteMetadata({
    name: program.sitePackageJson.name,
    sitePath: program.directory,
    lastRun: Date.now(),
    pid: process.pid,
  })

  markWebpackStatusAsPending()

  const publicDir = path.join(program.directory, `public`)
  if (!externalTelemetryAttributes) {
    await initTracer(
      process.env.GATSBY_OPEN_TRACING_CONFIG_FILE ||
        program.openTracingConfigFile
    )
  }

  const buildActivity = report.phantomActivity(`build`)
  buildActivity.start()

  const buildSpan = buildActivity.span
  buildSpan.setTag(`directory`, program.directory)

  // buildSpan に外部のタグを追加する
  if (externalTelemetryAttributes) {
    Object.entries(externalTelemetryAttributes).forEach(([key, value]) => {
      buildActivity.span.setTag(key, value)
    })
  }

  const { gatsbyNodeGraphQLFunction, workerPool, adapterManager } =
    await bootstrap({
      program,
      parentSpan: buildSpan,
    })

  await apiRunnerNode(`onPreBuild`, {
    graphql: gatsbyNodeGraphQLFunction,
    parentSpan: buildSpan,
  })

  // 同期と非同期の require ファイルをディスクに書き出す
  // ルーティングの "html" と "javascript" の中で使われる
  await writeOutRequires({
    store,
    parentSpan: buildSpan,
  })

  let closeJavascriptBundleCompilation: (() => Promise<void>) | undefined
  let closeHTMLBundleCompilation: (() => Promise<void>) | undefined
  let closePartialHydrationBundleCompilation: (() => Promise<void>) | undefined
  let webpackCompilationHash: string | null = null
  let webpackSSRCompilationHash: string | null = null
  let templateCompilationHashes: Record<string, string> = {}

  const engineBundlingPromises: Array<Promise<any>> = []
  const buildActivityTimer = report.activityTimer(
    `Building production JavaScript and CSS bundles`,
    { parentSpan: buildSpan }
  )
  buildActivityTimer.start()

  try {
    const { stats, close } = await buildProductionBundle(
      program,
      buildActivityTimer.span
    )
    closeJavascriptBundleCompilation = close

    if (stats.hasWarnings()) {
      const rawMessages = stats.toJson({ all: false, warnings: true })
      reportWebpackWarnings(rawMessages.warnings, report)
    }

    webpackCompilationHash = stats.hash as string
  } catch (err) {
    buildActivityTimer.panic(structureWebpackErrors(Stage.BuildJavascript, err))
  } finally {
    buildActivityTimer.end()
  }

  const buildSSRBundleActivityProgress = report.activityTimer(
    `Building HTML renderer`,
    { parentSpan: buildSpan }
  )
  buildSSRBundleActivityProgress.start()
  try {
    const { close, stats } = await buildRenderer(
      program,
      Stage.BuildHTML,
      buildSSRBundleActivityProgress.span
    )

    closeHTMLBundleCompilation = close
    if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
      const { renderPageHash, templateHashes } = getSSRChunkHashes({
        stats,
        components: store.getState().components,
      })
      webpackSSRCompilationHash = renderPageHash
      templateCompilationHashes = templateHashes
    } else {
      webpackSSRCompilationHash = stats.hash as string
    }

    await close()
  } catch (err) {
    buildActivityTimer.panic(structureWebpackErrors(Stage.BuildHTML, err))
  } finally {
    buildSSRBundleActivityProgress.end()
  }

  if (
    (process.env.GATSBY_PARTIAL_HYDRATION === `true` ||
      process.env.GATSBY_PARTIAL_HYDRATION === `1`) &&
    _CFLAGS_.GATSBY_MAJOR === `5`
  ) {
    const buildPartialHydrationBundleActivityProgress = report.activityTimer(
      `Building Partial Hydration renderer`,
      { parentSpan: buildSpan }
    )
    buildPartialHydrationBundleActivityProgress.start()
    try {
      const { buildPartialHydrationRenderer } = await import(`./build-html`)
      const { close } = await buildPartialHydrationRenderer(
        program,
        Stage.BuildHTML,
        buildPartialHydrationBundleActivityProgress.span
      )

      closePartialHydrationBundleCompilation = close

      await close()
    } catch (err) {
      buildActivityTimer.panic(structureWebpackErrors(Stage.BuildHTML, err))
    } finally {
      buildPartialHydrationBundleActivityProgress.end()
    }
  }

  // テンプレートごとに外側の config 関数を実行する
  const pageConfigActivity = report.activityTimer(`Execute page configs`, {
    parentSpan: buildSpan,
  })
  pageConfigActivity.start()
  try {
    await preparePageTemplateConfigs(gatsbyNodeGraphQLFunction)
  } catch (err) {
    reporter.panic(err)
  } finally {
    pageConfigActivity.end()
  }

  if (shouldGenerateEngines()) {
    const state = store.getState()
    const buildActivityTimer = report.activityTimer(
      `Building Rendering Engines`,
      { parentSpan: buildSpan }
    )
    try {
      buildActivityTimer.start()
      // graphql-engine をバンドルする
      engineBundlingPromises.push(
        createGraphqlEngineBundle(program.directory, report, program.verbose)
      )

      engineBundlingPromises.push(
        createPageSSRBundle({
          rootDir: program.directory,
          components: state.components,
          staticQueriesByTemplate: state.staticQueriesByTemplate,
          webpackCompilationHash: webpackCompilationHash as string, // webpackCompilationHash は上で設定している
          reporter: report,
          isVerbose: program.verbose,
        })
      )
      await Promise.all(engineBundlingPromises)
    } catch (err) {
      reporter.panic(err)
    } finally {
      buildActivityTimer.end()
    }

    await validateEnginesWithActivity(program.directory, buildSpan)
  }

  const cacheActivity = report.activityTimer(`Caching Webpack compilations`, {
    parentSpan: buildSpan,
  })
  try {
    cacheActivity.start()
    await Promise.all([
      closeJavascriptBundleCompilation?.(),
      closeHTMLBundleCompilation?.(),
      closePartialHydrationBundleCompilation?.(),
    ])
  } finally {
    cacheActivity.end()
  }

  const graphqlRunner = new GraphQLRunner(store, {
    collectStats: true,
    graphqlTracing: program.graphqlTracing,
  })

  const { queryIds } = await calculateDirtyQueries({ store })

  // モードが SSG のクエリだけを実行する

  queryIds.pageQueryIds = queryIds.pageQueryIds.filter(
    query => getPageMode(query) === `SSG`
  )

  // メインプロセスで page.mode の保存を開始する（その間、クエリはワーカーで並列に実行される）
  const waitMaterializePageMode = materializePageMode()

  let waitForWorkerPoolRestart = Promise.resolve()
  // クエリの実行をデバッグしたい場合は、CPU 数を 1 に設定できる
  if (cpuCoreCount() === 1) {
    await runStaticQueries({
      queryIds,
      parentSpan: buildSpan,
      store,
      graphqlRunner,
    })

    await runPageQueries({
      queryIds,
      graphqlRunner,
      parentSpan: buildSpan,
      store,
    })
  } else {
    await runQueriesInWorkersQueue(workerPool, queryIds, {
      parentSpan: buildSpan,
    })
    // クエリの実行が終わっても、ジョブはまだ実行中のことがある
    await Promise.all([
      waitUntilAllJobsComplete(),
      waitUntilWorkerJobsAreComplete(),
    ])
    // state のマージ中のメモリ負荷を下げるため、マージの前にワーカープールを再起動する
    waitForWorkerPoolRestart = workerPool.restart()
    await mergeWorkerState(workerPool, buildSpan)
  }

  if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
    await runSliceQueries({
      queryIds,
      graphqlRunner,
      parentSpan: buildSpan,
      store,
    })
  }

  const engineTemplatePaths = new Set<string>()
  {
    let SSGCount = 0
    let DSGCount = 0
    let SSRCount = 0

    for (const page of store.getState().pages.values()) {
      if (page.mode === `SSR`) {
        SSRCount++
        engineTemplatePaths.add(page.componentPath)
      } else if (page.mode === `DSG`) {
        DSGCount++
        engineTemplatePaths.add(page.componentPath)
      } else {
        SSGCount++
      }
    }
  }

  await copyStaticQueriesToEngine({
    engineTemplatePaths,
    staticQueriesByTemplate: store.getState().staticQueriesByTemplate,
    components: store.getState().components,
  })

  if (!(_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES)) {
    if (process.send && shouldGenerateEngines()) {
      await waitMaterializePageMode
      process.send({
        type: `LOG_ACTION`,
        action: {
          type: `ENGINES_READY`,
          timestamp: new Date().toJSON(),
        },
      })
    }
  }

  // state オブジェクトが漏れないようにスコープを作る
  {
    const state = store.getState()
    if (
      webpackCompilationHash !== state.webpackCompilationHash ||
      !appDataUtil.exists(publicDir)
    ) {
      store.dispatch({
        type: `SET_WEBPACK_COMPILATION_HASH`,
        payload: webpackCompilationHash,
      })

      const rewriteActivityTimer = report.activityTimer(
        `Rewriting compilation hashes`,
        {
          parentSpan: buildSpan,
        }
      )
      rewriteActivityTimer.start()

      await appDataUtil.write(publicDir, webpackCompilationHash as string)

      rewriteActivityTimer.end()
    }

    if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
      Object.entries(templateCompilationHashes).forEach(
        ([templatePath, templateHash]) => {
          const component = store.getState().components.get(templatePath)
          if (component) {
            const action = {
              type: `SET_SSR_TEMPLATE_WEBPACK_COMPILATION_HASH`,
              payload: {
                templatePath,
                templateHash,
                pages: component.pages,
                isSlice: component.isSlice,
              },
            }
            store.dispatch(action)
          } else {
            console.error({
              templatePath,
              templateHash,
              availableTemplates: [...store.getState().components.keys()],
            })
            throw new Error(
              `something changed in webpack but I don't know what`
            )
          }
        }
      )
    }

    if (state.html.ssrCompilationHash !== webpackSSRCompilationHash) {
      store.dispatch({
        type: `SET_SSR_WEBPACK_COMPILATION_HASH`,
        payload: webpackSSRCompilationHash,
      })
    }
  }

  await flushPendingPageDataWrites(buildSpan)
  markWebpackStatusAsDone()

  if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
    if (shouldGenerateEngines()) {
      const state = store.getState()
      const sliceDataPath = path.join(
        state.program.directory,
        `public`,
        `slice-data`
      )
      if (fs.existsSync(sliceDataPath)) {
        const destination = path.join(
          state.program.directory,
          `.cache`,
          `page-ssr`,
          `slice-data`
        )
        fs.copySync(sliceDataPath, destination)
      }

      if (process.send) {
        await waitMaterializePageMode
        process.send({
          type: `LOG_ACTION`,
          action: {
            type: `ENGINES_READY`,
            timestamp: new Date().toJSON(),
          },
        })
      }
    }
  }

  // static ディレクトリのファイルを、public 内の
  // 対応する static ディレクトリへコピーする。
  copyStaticDirs()

  store.dispatch(actions.setProgramStatus(`BOOTSTRAP_QUERY_RUNNING_FINISHED`))

  await db.saveState()

  await waitUntilAllJobsComplete()

  // 最新の state が保存されていることを保証するため、もう一度保存する必要がある
  await db.saveState()

  if (shouldGenerateEngines()) {
    // まあ、正直なところ、これは `.cache` に生成して、削除せずに済ませるべきだろう :shrug:
    program.keepPageRenderer = true
  }

  await waitForWorkerPoolRestart

  const { toRegenerate, toDelete } =
    await buildHTMLPagesAndDeleteStaleArtifacts({
      program,
      workerPool,
      parentSpan: buildSpan,
    })

  await waitMaterializePageMode
  const waitWorkerPoolEnd = Promise.all(workerPool.end())

  // state オブジェクトが漏れないようにスコープを作る
  {
    const { schema, definitions, config } = store.getState()
    const directory = program.directory
    const graphqlTypegenOptions = config.graphqlTypegen

    // オプションが有効な場合にだけ型を生成する
    if (graphqlTypegenOptions && graphqlTypegenOptions.generateOnBuild) {
      const typegenActivity = reporter.activityTimer(
        `Generating TypeScript types`,
        {
          parentSpan: buildSpan,
        }
      )
      typegenActivity.start()

      try {
        await writeTypeScriptTypes(
          directory,
          schema,
          definitions,
          graphqlTypegenOptions
        )
      } catch (err) {
        typegenActivity.panicOnBuild({
          id: `12100`,
          context: {
            sourceMessage: err,
          },
        })
      }

      typegenActivity.end()
    }
  }

  const postBuildActivityTimer = report.activityTimer(`onPostBuild`, {
    parentSpan: buildSpan,
  })
  postBuildActivityTimer.start()
  await apiRunnerNode(`onPostBuild`, {
    graphql: gatsbyNodeGraphQLFunction,
    parentSpan: postBuildActivityTimer.span,
  })
  postBuildActivityTimer.end()

  // onPostBuild で開始されたジョブを待つ
  // たとえば、sharp を呼び出すクエリが実行されたことで発生しうる
  await waitUntilAllJobsComplete()

  try {
    await waitWorkerPoolEnd
  } catch (e) {
    report.warn(`Error when closing WorkerPool: ${e.message}`)
  }

  // すべてのジョブがキャッシュされるよう、最新の state を保存しておく
  await db.saveState()

  const state = store.getState()
  reporter._renderPageTree({
    components: state.components,
    functions: state.functions,
    pages: state.pages,
    root: state.program.directory,
  })

  if (process.send) {
    const gatsbyCloudConfig = constructConfigObject(state.config)

    process.send({
      type: `LOG_ACTION`,
      action: {
        type: `GATSBY_CONFIG_KEYS`,
        payload: gatsbyCloudConfig,
        timestamp: new Date().toJSON(),
      },
    })
  }

  report.info(`Done building in ${process.uptime()} sec`)

  buildActivity.end()
  if (!externalTelemetryAttributes) {
    await stopTracer()
  }

  if (program.logPages) {
    if (toRegenerate.length) {
      report.info(
        `Built pages:\n${toRegenerate
          .map(path => `Updated page: ${path}`)
          .join(`\n`)}`
      )
    }

    if (toDelete.length) {
      report.info(
        `Deleted pages:\n${toDelete
          .map(path => `Deleted page: ${path}`)
          .join(`\n`)}`
      )
    }
  }

  if (program.writeToFile) {
    const createdFilesPath = path.resolve(
      `${program.directory}/.cache`,
      `newPages.txt`
    )
    const createdFilesContent = toRegenerate.length
      ? `${toRegenerate.join(`\n`)}\n`
      : ``

    const deletedFilesPath = path.resolve(
      `${program.directory}/.cache`,
      `deletedPages.txt`
    )
    const deletedFilesContent = toDelete.length
      ? `${toDelete.join(`\n`)}\n`
      : ``

    await fs.writeFile(createdFilesPath, createdFilesContent, `utf8`)
    report.info(`.cache/newPages.txt created`)

    await fs.writeFile(deletedFilesPath, deletedFilesContent, `utf8`)
    report.info(`.cache/deletedPages.txt created`)
  }

  if (adapterManager) {
    await adapterManager.storeCache()
    await adapterManager.adapt()
  }

  showExperimentNotices()

  if (await userGetsSevenDayFeedback()) {
    showSevenDayFeedbackRequest()
  } else if (await userPassesFeedbackRequestHeuristic()) {
    showFeedbackRequest()
  }
}
