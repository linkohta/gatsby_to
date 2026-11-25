const Promise = require(`bluebird`)
const _ = require(`lodash`)
// chalk 5 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: chalk } = require(`chalk`)
const { bindActionCreators: origBindActionCreators } = require(`redux`)
const memoize = require(`memoizee`)

const bindActionCreators = memoize(origBindActionCreators)

const tracer = require(`opentracing`).globalTracer()
const reporter = require(`gatsby-cli/lib/reporter`)
const stackTrace = require(`stack-trace`)
const { codeFrameColumns } = require(`gatsby-core-utils/code-frame`)
const fs = require(`fs-extra`)
const { getCache } = require(`./get-cache`)
import { createNodeId } from "./create-node-id"
const { createContentDigest: _createContentDigest } = require(
  `gatsby-core-utils`
)
import {
  buildObjectType,
  buildUnionType,
  buildInterfaceType,
  buildInputObjectType,
  buildEnumType,
  buildScalarType,
} from "../schema/types/type-builders"
const { emitter, store } = require(`../redux`)
const { getNodes, getNode, getNodesByType } = require(`../datastore`)
const { getNodeAndSavePathDependency, loadNodeContent } = require(`./nodes`)
const { getPublicPath } = require(`./get-public-path`)
const { importGatsbyPlugin } = require(`./import-gatsby-plugin`)
const { getNonGatsbyCodeFrameFormatted } = require(`./stack-trace-utils`)
import errorParser from "./api-runner-error-parser"
import { wrapNode, wrapNodes } from "./detect-node-mutations"
import { reportOnce } from "./report-once"

// 一貫したダイジェストになるように、createContentDigest を上書きして、
// 自動生成されたデータをノードから取り除く。
function createContentDigest(node) {
  if (!node?.internal?.type) {
    // これはノードのようには見えないので、そのまま渡す
    return _createContentDigest(node)
  }
  return _createContentDigest({
    ...node,
    internal: {
      ...node.internal,
      // 一貫した contentDigest の作成を妨げる、
      // 自動生成されたフィールドを取り除く。
      contentDigest: undefined,
      owner: undefined,
      fieldOwners: undefined,
      ignoreType: undefined,
      counter: undefined,
    },
    fields: undefined,
  })
}

if (!process.env.BLUEBIRD_DEBUG && !process.env.BLUEBIRD_LONG_STACK_TRACES) {
  // 指定されていない限り、longStackTraces を無効にする
  // これはパフォーマンスへの悪影響が大きいためである ( http://bluebirdjs.com/docs/api/promise.longstacktraces.html )
  // これは主に `gatsby develop` のためのものである。NODE_ENV が development に設定され、
  // それによって bluebird が longStackTraces を有効にするためである
  // `gatsby build`（NODE_ENV=production）では、もともと longStackTraces は有効にならない
  Promise.config({ longStackTraces: false })
}

const nodeMutationsWrappers = {
  getNode(id) {
    return wrapNode(getNode(id))
  },
  getNodes() {
    return wrapNodes(getNodes())
  },
  getNodesByType(type) {
    return wrapNodes(getNodesByType(type))
  },
  getNodeAndSavePathDependency(id) {
    return wrapNode(getNodeAndSavePathDependency(id))
  },
}

// 作成するアクションにメタデータを自動的に追加できるように、
// アクションクリエイターをプラグインごとにバインドする。
const boundPluginActionCreators = {}
const doubleBind = (boundActionCreators, api, plugin, actionOptions) => {
  const { traceId, deferNodeMutation } = actionOptions
  const defer = deferNodeMutation ? `defer-node-mutation` : ``
  const actionKey = plugin.name + api + traceId + defer
  if (boundPluginActionCreators[actionKey]) {
    return boundPluginActionCreators[actionKey]
  } else {
    const keys = Object.keys(boundActionCreators)
    const doubleBoundActionCreators = {}
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      const boundActionCreator = boundActionCreators[key]
      if (typeof boundActionCreator === `function`) {
        doubleBoundActionCreators[key] = (...args) => {
          if (args.length === 0) {
            return boundActionCreator(plugin, actionOptions)
          }
          // アクションの呼び出し側が、プラグインが誰であるかを上書きできるようにする。
          // それほど頻繁に使われるべきものではない。
          else if (args.length === 1) {
            return boundActionCreator(args[0], plugin, actionOptions)
          } else if (args.length === 2) {
            return boundActionCreator(args[0], args[1], actionOptions)
          }

          reportOnce(
            `Unhandled redux action: ${key}, in plugin: ${plugin.name}`
          )

          return undefined
        }
      }
    }
    boundPluginActionCreators[actionKey] = doubleBoundActionCreators
    return doubleBoundActionCreators
  }
}

const initAPICallTracing = parentSpan => {
  const startSpan = (spanName, spanArgs = {}) => {
    const defaultSpanArgs = { childOf: parentSpan }

    return tracer.startSpan(spanName, _.merge(defaultSpanArgs, spanArgs))
  }

  return {
    tracer,
    parentSpan,
    startSpan,
  }
}

const deferredAction =
  type =>
  (...args) => {
    // 通常の createNode は Promise を返すが、遅延させる場合は、別の Promise でラップし、
    // 実際に呼ばれたときにそれを解決する必要がある
    if (type === `createNode`) {
      return new Promise(resolve => {
        emitter.emit(`ENQUEUE_NODE_MUTATION`, {
          type,
          payload: args,
          resolve,
        })
      })
    }
    return emitter.emit(`ENQUEUE_NODE_MUTATION`, {
      type,
      payload: args,
    })
  }

const NODE_MUTATION_ACTIONS = [
  `createNode`,
  `deleteNode`,
  `touchNode`,
  `createParentChildLink`,
  `createNodeField`,
]

const deferActions = actions => {
  const deferred = { ...actions }
  NODE_MUTATION_ACTIONS.forEach(action => {
    deferred[action] = deferredAction(action)
  })
  return deferred
}

/**
 * ローカルの reporter を作成する
 * reporter のメソッドをアクティビティのメソッドで上書きするために使う
 */
function getLocalReporter({ activity, reporter }) {
  // アクティビティがある場合は、panicOnBuild をアクティビティのメソッドに
  // バインドして、両者を結び付ける
  if (activity) {
    return { ...reporter, panicOnBuild: activity.panicOnBuild.bind(activity) }
  }

  return reporter
}

function getErrorMapWithPluginName(pluginName, errorMap) {
  const entries = Object.entries(errorMap)

  return entries.reduce((memo, [key, val]) => {
    memo[`${pluginName}_${key}`] = val

    return memo
  }, {})
}

function extendLocalReporterToCatchPluginErrors({
  reporter,
  pluginName,
  runningActivities,
}) {
  let setErrorMap

  let error = reporter.error
  let panic = reporter.panic
  let panicOnBuild = reporter.panicOnBuild

  if (pluginName && reporter?.setErrorMap) {
    setErrorMap = errorMap =>
      reporter.setErrorMap(getErrorMapWithPluginName(pluginName, errorMap))

    error = (errorMeta, error) => {
      reporter.error(errorMeta, error, pluginName)
    }

    panic = (errorMeta, error) => {
      reporter.panic(errorMeta, error, pluginName)
    }

    panicOnBuild = (errorMeta, error) => {
      reporter.panicOnBuild(errorMeta, error, pluginName)
    }
  }

  return {
    ...reporter,
    setErrorMap,
    error,
    panic,
    panicOnBuild,
    // ここで引数を変更する場合は、reporter.ts も更新すること
    activityTimer: (text, activityArgs = {}) => {
      let args = [text, activityArgs]

      if (pluginName && setErrorMap) {
        args = [...args, pluginName]
      }

      // eslint-disable-next-line prefer-spread
      const activity = reporter.activityTimer.apply(reporter, args)

      const originalStart = activity.start
      const originalEnd = activity.end

      activity.start = () => {
        originalStart.apply(activity)
        runningActivities.add(activity)
      }

      activity.end = () => {
        originalEnd.apply(activity)
        runningActivities.delete(activity)
      }

      return activity
    },
    // ここで引数を変更する場合は、reporter.ts も更新すること
    createProgress: (text, total = 0, start = 0, activityArgs = {}) => {
      let args = [text, total, start, activityArgs]

      if (pluginName && setErrorMap) {
        args = [...args, pluginName]
      }

      // eslint-disable-next-line prefer-spread
      const activity = reporter.createProgress.apply(reporter, args)

      const originalStart = activity.start
      const originalEnd = activity.end
      const originalDone = activity.done

      activity.start = () => {
        originalStart.apply(activity)
        runningActivities.add(activity)
      }

      activity.end = () => {
        originalEnd.apply(activity)
        runningActivities.delete(activity)
      }

      activity.done = () => {
        originalDone.apply(activity)
        runningActivities.delete(activity)
      }

      return activity
    },
  }
}

const getUninitializedCache = plugin => {
  const message =
    `Usage of "cache" instance in "onPreInit" API is not supported as ` +
    `this API runs before cache initialization` +
    (plugin && plugin !== `default-site-plugin` ? ` (called in ${plugin})` : ``)

  return {
    // GatsbyCache
    async get() {
      throw new Error(message)
    },
    async set() {
      throw new Error(message)
    },
    async del() {
      throw new Error(message)
    },
  }
}

const availableActionsCache = new Map()
let publicPath
const runAPI = async (plugin, api, args, activity) => {
  const gatsbyNode = await importGatsbyPlugin(plugin, `gatsby-node`)

  if (gatsbyNode[api]) {
    const parentSpan = args && args.parentSpan
    const spanOptions = parentSpan ? { childOf: parentSpan } : {}
    const pluginSpan = tracer.startSpan(`run-plugin`, spanOptions)

    pluginSpan.setTag(`api`, api)
    pluginSpan.setTag(`plugin`, plugin.name)
    const { publicActions, restrictedActionsAvailableInAPI } = require(
      `../redux/actions`
    )

    let availableActions
    if (availableActionsCache.has(api)) {
      availableActions = availableActionsCache.get(api)
    } else {
      availableActions = {
        ...publicActions,
        ...(restrictedActionsAvailableInAPI[api] || {}),
      }

      availableActionsCache.set(api, availableActions)
    }

    let boundActionCreators = bindActionCreators(
      availableActions,
      store.dispatch
    )

    if (args.deferNodeMutation) {
      boundActionCreators = deferActions(boundActionCreators)
    }

    const doubleBoundActionCreators = doubleBind(
      boundActionCreators,
      api,
      plugin,
      { ...args, parentSpan: pluginSpan, activity }
    )

    const { config, program } = store.getState()

    const pathPrefix = (program.prefixPaths && config.pathPrefix) || ``

    if (typeof publicPath === `undefined`) {
      publicPath = getPublicPath({ ...config, ...program }, ``)
    }

    const namespacedCreateNodeId = id => createNodeId(id, plugin.name)

    const tracing = initAPICallTracing(pluginSpan)

    // https://github.com/gatsbyjs/gatsby/issues/11369 を参照
    const cache =
      api === `onPreInit`
        ? getUninitializedCache(plugin.name)
        : getCache(plugin.name)

    // 理想的には、これをもっと抽象化して、より多くの状況に適用したい。しかし現状では
    // 破壊的変更になる可能性があるので、`createPages` API と `createPage` アクションだけを対象にする
    let actions = doubleBoundActionCreators
    let apiFinished = false
    if (api === `createPages`) {
      let alreadyDisplayed = false
      const createPageAction = actions.createPage
      // createPage アクションをラップした、新しい actions オブジェクトを作成する
      // doubleBoundActionCreators はメモ化されているので、単純に createPage フィールドを
      // 代入し直すことはできない。そうすると、この追加のロジックが以降の API でも
      // 使われてしまうが、対象にしたいのはこの `createPages` の呼び出しだけである。
      actions = {
        ...actions,
        createPage: (...args) => {
          createPageAction(...args)
          if (apiFinished && !alreadyDisplayed) {
            const warning = [
              reporter.stripIndent(`
              Action ${chalk.bold(
                `createPage`
              )} was called outside of its expected asynchronous lifecycle ${chalk.bold(
                `createPages`
              )} in ${chalk.bold(plugin.name)}.
              Ensure that you return a Promise from ${chalk.bold(
                `createPages`
              )} and are awaiting any asynchronous method invocations (like ${chalk.bold(
                `graphql`
              )} or http requests).
              For more info and debugging tips: see ${chalk.bold(
                `https://gatsby.dev/sync-actions`
              )}
            `),
            ]

            const possiblyCodeFrame = getNonGatsbyCodeFrameFormatted()
            if (possiblyCodeFrame) {
              warning.push(possiblyCodeFrame)
            }

            reporter.warn(warning.join(`\n\n`))
            alreadyDisplayed = true
          }
        },
      }
    }

    const localReporter = getLocalReporter({ activity, reporter })

    const runningActivities = new Set()

    const extendedLocalReporter = extendLocalReporterToCatchPluginErrors({
      reporter: localReporter,
      pluginName: plugin.name,
      runningActivities,
    })

    const endInProgressActivitiesCreatedByThisRun = () => {
      runningActivities.forEach(activity => activity.end())
    }

    const shouldDetectNodeMutations = [
      `sourceNodes`,
      `onCreateNode`,
      `createResolvers`,
      `createSchemaCustomization`,
      `setFieldsOnGraphQLNodeType`,
    ].includes(api)

    const apiCallArgs = [
      {
        ...args,
        parentSpan: pluginSpan,
        basePath: pathPrefix,
        pathPrefix: publicPath,
        actions,
        loadNodeContent,
        store,
        emitter,
        getCache,
        getNodes: shouldDetectNodeMutations
          ? nodeMutationsWrappers.getNodes
          : getNodes,
        getNode: shouldDetectNodeMutations
          ? nodeMutationsWrappers.getNode
          : getNode,
        getNodesByType: shouldDetectNodeMutations
          ? nodeMutationsWrappers.getNodesByType
          : getNodesByType,
        reporter: extendedLocalReporter,
        getNodeAndSavePathDependency: shouldDetectNodeMutations
          ? nodeMutationsWrappers.getNodeAndSavePathDependency
          : getNodeAndSavePathDependency,
        cache,
        createNodeId: namespacedCreateNodeId,
        createContentDigest,
        tracing,
        schema: {
          buildObjectType,
          buildUnionType,
          buildInterfaceType,
          buildInputObjectType,
          buildEnumType,
          buildScalarType,
        },
      },
      plugin.pluginOptions,
    ]

    // プラグインがコールバックを使っている場合はそれを使い、そうでなければ
    // Promise が返されることを期待する。
    if (gatsbyNode[api].length === 3) {
      return Promise.fromCallback(callback => {
        const cb = (err, val) => {
          pluginSpan.finish()
          apiFinished = true
          endInProgressActivitiesCreatedByThisRun()
          callback(err, val)
        }

        gatsbyNode[api](...apiCallArgs, cb)
      })
    } else {
      try {
        return await gatsbyNode[api](...apiCallArgs)
      } finally {
        pluginSpan.finish()
        apiFinished = true
        endInProgressActivitiesCreatedByThisRun()
      }
    }
  }

  return null
}

const apisRunningById = new Map()
const apisRunningByTraceId = new Map()
let waitingForCasacadeToFinish = []

function apiRunnerNode(api, args = {}, { pluginSource, activity } = {}) {
  const plugins = store.getState().flattenedPlugins

  // この API を実装しているプラグインの一覧を取得する。
  // あわせて、無限ループを断ち切る。プラグインが API を実装し、その中で
  // アクションを呼び、それによって同じ API が呼ばれることがある。
  // 現状では `onCreatePage` が唯一の例である。このような場合は、
  // 呼び出し元のプラグインをもう一度呼ばないようにすべきである。
  let implementingPlugins = plugins.filter(
    plugin => plugin.nodeAPIs.includes(api) && plugin.name !== pluginSource
  )

  if (api === `sourceNodes` && args.pluginName) {
    implementingPlugins = implementingPlugins.filter(
      plugin => plugin.name === args.pluginName
    )
  }

  // 実装しているプラグインがなければ、早めに戻る。
  if (implementingPlugins.length === 0) {
    return null
  }

  return new Promise(resolve => {
    const { parentSpan, traceId, traceTags, waitForCascadingActions } = args
    const apiSpanArgs = parentSpan ? { childOf: parentSpan } : {}
    const apiSpan = tracer.startSpan(`run-api`, apiSpanArgs)

    apiSpan.setTag(`api`, api)
    _.forEach(traceTags, (value, key) => {
      apiSpan.setTag(key, value)
    })

    const apiRunInstance = {
      api,
      args,
      pluginSource,
      resolve,
      span: apiSpan,
      startTime: new Date().toJSON(),
      traceId,
    }

    // API の実行に対する ID を生成する。ほとんどの ID は引数から生成するが、
    // 一部の API の呼び出しは引数のオブジェクトが非常に大きくなることがあるので、
    // 大きなオブジェクトを文字列化しないように、それらには ID を生成する
    // 特別な方法がある。
    let id
    if (api === `setFieldsOnGraphQLNodeType`) {
      id = `${api}${apiRunInstance.startTime}${args.type.name}${traceId}`
    } else if (api === `onCreateNode`) {
      id = `${api}${apiRunInstance.startTime}${args.node.internal.contentDigest}${traceId}`
    } else if (api === `preprocessSource`) {
      id = `${api}${apiRunInstance.startTime}${args.filename}${traceId}`
    } else if (api === `onCreatePage`) {
      id = `${api}${apiRunInstance.startTime}${args.page.path}${traceId}`
    } else {
      // トレースが有効になっていると、`args` オブジェクトは `parentSpan`
      // フィールドを持ち、これがかなり大きくなることがある。そのため、
      // stringify を呼ぶ前に取り除く
      const argsJson = JSON.stringify(_.omit(args, `parentSpan`))
      id = `${api}|${apiRunInstance.startTime}|${apiRunInstance.traceId}|${argsJson}`
    }
    apiRunInstance.id = id

    if (waitForCascadingActions) {
      waitingForCasacadeToFinish.push(apiRunInstance)
    }

    if (apisRunningById.size === 0) {
      emitter.emit(`API_RUNNING_START`)
    }

    apisRunningById.set(apiRunInstance.id, apiRunInstance)
    if (apisRunningByTraceId.has(apiRunInstance.traceId)) {
      const currentCount = apisRunningByTraceId.get(apiRunInstance.traceId)
      apisRunningByTraceId.set(apiRunInstance.traceId, currentCount + 1)
    } else {
      apisRunningByTraceId.set(apiRunInstance.traceId, 1)
    }

    let stopQueuedApiRuns = false
    let onAPIRunComplete = null
    if (api === `onCreatePage`) {
      const path = args.page.path
      const actionHandler = action => {
        if (action.payload.path === path) {
          stopQueuedApiRuns = true
        }
      }
      emitter.on(`DELETE_PAGE`, actionHandler)
      onAPIRunComplete = () => {
        emitter.off(`DELETE_PAGE`, actionHandler)
      }
    }

    let apiRunPromiseOptions = {}
    let runPromise
    if (
      api === `sourceNodes` &&
      process.env.GATSBY_EXPERIMENTAL_PARALLEL_SOURCING
    ) {
      runPromise = Promise.map
      apiRunPromiseOptions.concurrency = 20
    } else {
      runPromise = Promise.mapSeries
      apiRunPromiseOptions = undefined
    }

    runPromise(
      implementingPlugins,
      plugin => {
        if (stopQueuedApiRuns) {
          return null
        }

        return importGatsbyPlugin(plugin, `gatsby-node`).then(gatsbyNode => {
          const pluginName =
            plugin.name === `default-site-plugin`
              ? `gatsby-node.js`
              : plugin.name

          // TODO: これをうまく扱えるように、createNode API を考え直す
          if (
            api === `onCreateNode` &&
            gatsbyNode?.shouldOnCreateNode && // この api が export されていなくても中断しない
            !gatsbyNode.shouldOnCreateNode(
              { node: args.node },
              plugin.pluginOptions
            )
          ) {
            // このノードとこのプラグインについては、非同期のイベントを予約しようとしない
            return null
          }

          return new Promise(resolve => {
            resolve(
              runAPI(plugin, api, { ...args, parentSpan: apiSpan }, activity)
            )
          }).catch(err => {
            const localReporter = getLocalReporter({ activity, reporter })

            const file = stackTrace
              .parse(err)
              .find(file => /gatsby-node/.test(file.fileName))

            let codeFrame = ``
            const structuredError = errorParser({ err })

            if (file) {
              const { fileName, lineNumber: line, columnNumber: column } = file
              const trimmedFileName = fileName.match(/^(async )?(.*)/)[2]

              try {
                const code = fs.readFileSync(trimmedFileName, {
                  encoding: `utf-8`,
                })
                codeFrame = codeFrameColumns(
                  code,
                  {
                    start: {
                      line,
                      column,
                    },
                  },
                  {
                    highlightCode: true,
                  }
                )
              } catch (_e) {
                // スタックトレースが存在しないファイルを指していることがある
                // 特に、ファイルがトランスパイルされて、パスが実際に変わる場合に起きる
                // （存在しない `src` ディレクトリや、元の typescript ファイルを指すなど）
              }

              structuredError.location = {
                start: { line: line, column: column },
              }
              structuredError.filePath = fileName
            }

            structuredError.context = {
              ...structuredError.context,
              pluginName,
              api,
              codeFrame,
            }

            localReporter.panicOnBuild(structuredError)

            return null
          })
        })
      },
      apiRunPromiseOptions
    ).then(results => {
      if (onAPIRunComplete) {
        onAPIRunComplete()
      }
      // ランナーのインスタンスを取り除く
      apisRunningById.delete(apiRunInstance.id)
      const currentCount = apisRunningByTraceId.get(apiRunInstance.traceId)
      apisRunningByTraceId.set(apiRunInstance.traceId, currentCount - 1)

      if (apisRunningById.size === 0) {
        emitter.emit(`API_RUNNING_QUEUE_EMPTY`)
      }

      // 空の結果を取り除く
      apiRunInstance.results = results.filter(result => !_.isEmpty(result))

      // 空のレスポンスを取り除き、API の呼び出し側が連鎖的なアクションの
      // 完了を待っていなければ戻る。
      if (!waitForCascadingActions) {
        apiSpan.finish()
        resolve(apiRunInstance.results)
      }

      // 待っているもののうち、完了したものがあるかを確認する。
      waitingForCasacadeToFinish = waitingForCasacadeToFinish.filter(
        instance => {
          // そのトレース ID がどれも実行中でなければ、完了している。
          const apisByTraceIdCount = apisRunningByTraceId.get(instance.traceId)
          if (apisByTraceIdCount === 0) {
            instance.span.finish()
            instance.resolve(instance.results)
            return false
          } else {
            return true
          }
        }
      )
      return
    })
  })
}

module.exports = apiRunnerNode
