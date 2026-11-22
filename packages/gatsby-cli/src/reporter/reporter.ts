import { stripIndent } from "common-tags"
import chalk from "chalk"
import { globalTracer, Span, SpanContext } from "opentracing"

import * as reduxReporterActions from "./redux/actions"
import { LogLevels, ActivityStatuses } from "./constants"
import { getErrorFormatter } from "./errors"
import constructError from "../structured-errors/construct-error"
import {
  IErrorMapEntryPublicApi,
  ErrorId,
} from "../structured-errors/error-map"
import { prematureEnd } from "./catch-exit-signals"
import { IConstructError, IStructuredError } from "../structured-errors/types"
import { createTimerReporter, ITimerReporter } from "./reporter-timer"
import { createPhantomReporter, IPhantomReporter } from "./reporter-phantom"
import { createProgressReporter, IProgressReporter } from "./reporter-progress"
import {
  ErrorMeta,
  CreateLogAction,
  ILogIntent,
  IRenderPageArgs,
} from "./types"
import {
  registerAdditionalDiagnosticOutputHandler,
  AdditionalDiagnosticsOutputHandler,
} from "./redux/diagnostics"
import { isTruthy } from "gatsby-core-utils/is-truthy"

const errorFormatter = getErrorFormatter()
const tracer = globalTracer()

let reporterActions = reduxReporterActions

export interface IActivityArgs {
  id?: string
  parentSpan?: Span | SpanContext
  tags?: { [key: string]: any }
}

// eslint-disable-next-line prefer-const
let isVerbose = isTruthy(process.env.GATSBY_REPORTER_ISVERBOSE)

function isLogIntentMessage(msg: any): msg is ILogIntent {
  return msg && msg.type === `LOG_INTENT`
}

/**
 * レポーターモジュール。
 * @module reporter
 */
class Reporter {
  /**
   * 先頭のインデントを取り除くテンプレート関数。
   */
  stripIndent = stripIndent
  format = chalk

  errorMap: Record<ErrorId, IErrorMapEntryPublicApi> = {}

  /**
   * レポーターにカスタムのエラーマップを設定する。これにより、
   * レポーターの内部のエラーマップを拡張できる
   *
   * 注意: 指定する ID は、内部で使っているものと重ならないのが望ましい:
   * https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby-cli/src/structured-errors/error-map.ts
   */

  setErrorMap = (entry: Record<string, IErrorMapEntryPublicApi>): void => {
    this.errorMap = {
      ...this.errorMap,
      ...entry,
    }
  }

  /**
   * 詳細出力を切り替える。
   */
  setVerbose = (_isVerbose: boolean = true): void => {
    isVerbose = _isVerbose
    process.env.GATSBY_REPORTER_ISVERBOSE = isVerbose ? `1` : `0`
  }

  /**
   * エラー出力の色付けを無効にする。
   */
  setNoColor = (isNoColor: boolean = false): void => {
    if (isNoColor) {
      errorFormatter.withoutColors()
    }

    // ターミナル出力の色付けによく使われるパッケージで、色を無効にする
    //  - chalk: https://www.npmjs.com/package/chalk#chalksupportscolor を参照
    //  - ansi-colors: https://github.com/doowb/ansi-colors/blob/8024126c7115a0efb25a9a0e87bc5e29fd66831f/index.js#L5-L7 を参照
    if (isNoColor) {
      process.env.FORCE_COLOR = `0`
      // chalk は import の時点で色のレベルを決める。ここに到達する前に
      // chalk はすでに import されているので、後からレベルを調整する必要がある
      chalk.level = 0
    }
  }

  /**
   * 引数をログに出力し、ステータス 1 でプロセスを終了する。
   */
  panic = (
    errorMeta: ErrorMeta,
    error?: Error | Array<Error>,
    pluginName?: string
  ): never => {
    this.error(errorMeta, error, pluginName)
    prematureEnd()
    return process.exit(1)
  }

  panicOnBuild = (
    errorMeta: ErrorMeta,
    error?: Error | Array<Error>,
    pluginName?: string
  ): IStructuredError | Array<IStructuredError> => {
    const reporterError = this.error(errorMeta, error, pluginName)
    if (process.env.gatsby_executing_command === `build`) {
      prematureEnd()
      process.exit(1)
    }
    return reporterError
  }

  error = (
    errorMeta: ErrorMeta | Array<ErrorMeta>,
    error?: Error | Array<Error>,
    pluginName?: string
  ): IStructuredError | Array<IStructuredError> => {
    let details: IConstructError["details"] = {
      context: {},
    }

    // 後方互換性を保つため、経路がたくさんある :scream:
    // 1.
    //   reporter.error(any, Error);
    //   reporter.error(any, [Error]);
    if (error) {
      if (Array.isArray(error)) {
        return error.map(errorItem =>
          this.error(errorMeta, errorItem)
        ) as Array<IStructuredError>
      }
      details.error = error
      details.context = {
        sourceMessage: errorMeta + ` ` + error.message,
      }
      // 2.
      //    reporter.error(Error);
    } else if (errorMeta instanceof Error) {
      details.error = errorMeta
      details.context = {
        sourceMessage: errorMeta.message,
      }
      // 3.
      //    reporter.error([Error]);
    } else if (Array.isArray(errorMeta)) {
      // メッセージの配列を受け取った場合は、エラーごとにこの関数を 1 回ずつ呼び出す
      return errorMeta.map(errorItem =>
        this.error(errorItem)
      ) as Array<IStructuredError>
      // 4.
      //    reporter.error(errorMeta);
    } else if (typeof errorMeta === `object`) {
      details = { ...errorMeta }
      // 5.
      //    reporter.error('foo');
    } else if (typeof errorMeta === `string`) {
      details.context = {
        sourceMessage: errorMeta,
      }
    }

    if (pluginName) {
      details.pluginName = pluginName
      const id = details?.id

      if (id) {
        const isPrefixed = id.includes(`${pluginName}_`)
        if (!isPrefixed) {
          details.id = `${pluginName}_${id}`
        }
      }
    }

    const structuredError = constructError({ details }, this.errorMap)

    if (structuredError) {
      reporterActions.createLog(structuredError)
    }

    // TODO: Error コンポーネントでこの情報を描画できるようになったら削除する
    // 整形したスタックトレースをログに出力する
    if (structuredError.error) {
      this.log(errorFormatter.render(structuredError.error))
    }
    return structuredError
  }

  /**
   * 稼働時間に接頭辞を設定する。
   */
  uptime = (prefix: string): void => {
    this.verbose(`${prefix}: ${(process.uptime() * 1000).toFixed(3)}ms`)
  }

  verbose = (text: string): void => {
    if (isVerbose) {
      reporterActions.createLog({
        level: LogLevels.Debug,
        text,
      })
    }
  }

  success = (text?: string): CreateLogAction =>
    reporterActions.createLog({ level: LogLevels.Success, text })
  info = (text?: string): CreateLogAction =>
    reporterActions.createLog({ level: LogLevels.Info, text })
  warn = (text?: string): CreateLogAction =>
    reporterActions.createLog({ level: LogLevels.Warning, text })
  log = (text?: string): CreateLogAction =>
    reporterActions.createLog({ level: LogLevels.Log, text })

  pendingActivity = reporterActions.createPendingActivity

  completeActivity = (
    id: string,
    status: ActivityStatuses = ActivityStatuses.Success
  ): void => {
    reporterActions.endActivity({ id, status })
  }

  /**
   * アクティビティの時間を計測する。
   */
  activityTimer = (
    text: string,
    activityArgs: IActivityArgs = {},
    pluginName?: string
  ): ITimerReporter => {
    let { parentSpan, id, tags } = activityArgs
    const spanArgs = parentSpan ? { childOf: parentSpan, tags } : { tags }
    if (!id) {
      id = text
    }

    const span = tracer.startSpan(text, spanArgs)

    return createTimerReporter({
      text,
      id,
      span,
      reporter: this,
      reporterActions,
      pluginName,
    })
  }

  /**
   * ユーザーには見えないアクティビティを作成する
   *
   * Gatsby のプロセスのライフサイクルの中では、非同期の処理を行い、その完了を
   * 待つ必要が生じることがある。典型的な例はジョブである。
   * こうした処理は、実行中はプロセスのステータスを `in progress` にし、完了したら
   * `complete`（または `failure`）にすべきである。アクティビティはまさにこれを行う。
   * ただし、アクティビティはユーザーに表示される。そこでこの関数を使うと、CLI には
   * 表示されないがプロセスのステータスは変化させる _非表示の_ アクティビティを作成できる。
   */
  phantomActivity = (
    text: string,
    activityArgs: IActivityArgs = {}
  ): IPhantomReporter => {
    let { parentSpan, id, tags } = activityArgs
    const spanArgs = parentSpan ? { childOf: parentSpan, tags } : { tags }
    if (!id) {
      id = text
    }

    const span = tracer.startSpan(text, spanArgs)

    return createPhantomReporter({ id, text, span, reporterActions })
  }

  /**
   * アクティビティ用のプログレスバーを作成する
   */
  createProgress = (
    text: string,
    total = 0,
    start = 0,
    activityArgs: IActivityArgs = {},
    pluginName?: string
  ): IProgressReporter => {
    let { parentSpan, id, tags } = activityArgs
    const spanArgs = parentSpan ? { childOf: parentSpan, tags } : { tags }
    if (!id) {
      id = text
    }
    const span = tracer.startSpan(text, spanArgs)

    return createProgressReporter({
      id,
      text,
      total,
      start,
      span,
      reporter: this,
      reporterActions,
      pluginName,
    })
  }

  // このメソッドは古いバージョンの gatsby から呼ばれていたので、gatsby@<2.16 を gatsby-cli@>=2.8 と組み合わせたときに
  // "reporter._setStage is not a function" エラーが出ないよう、残しておく必要がある
  _setStage = (): void => {}

  // このメソッドは、コアがワーカープロセスを初期化するときに呼び出す。これにより、ワーカーはメインプロセスと通信し、
  // ワーカーが作成した構造化ログを親プロセスへディスパッチできる。
  _initReporterMessagingInWorker(sendMessage: (msg: ILogIntent) => void): void {
    const intentifiedActionCreators = {}
    for (const actionCreatorName of Object.keys(reduxReporterActions) as Array<
      keyof typeof reduxReporterActions
    >) {
      // reporter の各アクションクリエイターを、意図をメインプロセスへ送る関数に
      // 差し替える
      intentifiedActionCreators[actionCreatorName] = (...args): void => {
        sendMessage({
          type: `LOG_INTENT`,
          payload: {
            name: actionCreatorName,
            args,
          } as any,
        })
      }
    }
    reporterActions = intentifiedActionCreators as typeof reduxReporterActions
  }

  // このメソッドは、コアがワーカープールを初期化するときに呼び出す。これにより、メインプロセスはワーカーからの
  // メッセージを受け取り、ワーカーが作成した構造化ログを親プロセスへディスパッチできる。
  _initReporterMessagingInMain(
    onMessage: (listener: (msg: ILogIntent | unknown) => void) => void
  ): void {
    onMessage(msg => {
      if (isLogIntentMessage(msg)) {
        reduxReporterActions[msg.payload.name].call(
          reduxReporterActions,
          // @ts-ignore Next line (`...msg.payload.args`) cause "A spread argument
          // must either have a tuple type or be passed to a rest parameter"
          ...msg.payload.args
        )
      }
    })
  }

  _renderPageTree(args: IRenderPageArgs): void {
    reporterActions.renderPageTree(args)
  }

  _registerAdditionalDiagnosticOutputHandler(
    handler: AdditionalDiagnosticsOutputHandler
  ): void {
    registerAdditionalDiagnosticOutputHandler(handler)
  }
}
export type { Reporter }
export const reporter = new Reporter()
