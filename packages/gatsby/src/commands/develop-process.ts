import { syncStaticDir } from "../utils/get-static-dir"
import reporter from "gatsby-cli/lib/reporter"
import { isTruthy } from "gatsby-core-utils"
import express from "express"
import inspector from "inspector"
import { initTracer } from "../utils/tracer"
import { detectPortInUseAndPrompt } from "../utils/detect-port-in-use-and-prompt"
import {
  userGetsSevenDayFeedback,
  userPassesFeedbackRequestHeuristic,
  showFeedbackRequest,
  showSevenDayFeedbackRequest,
} from "../utils/feedback"
import { markWebpackStatusAsPending } from "../utils/webpack-status"

import { IProgram, IDebugInfo } from "./types"
import { interpret } from "xstate"
import { globalTracer } from "opentracing"
import { developMachine } from "../state-machines/develop"
import { logTransitions } from "../utils/state-machine-logging"

const tracer = globalTracer()

// const isInteractive = process.stdout.isTTY

// static ディレクトリを監視し、ファイルが追加または変更されたら public へ
// コピーする。コピーが通常のブートストラップを妨げないよう、
// 10 秒待つ。
setTimeout(() => {
  syncStaticDir()
}, 10000)

// また別の話になるが...
// 親プロセスが SIGKILL で終了させられたとき、Node は spawn した子プロセスを終了させない
// そのため、親がまだ生きているかを確認するために、定期的にハートビートを親へ送る
// 親がいなければ Error [ERR_IPC_CHANNEL_CLOSED]: Channel closed でクラッシュし、
// その結果、孤児になった子プロセスが終了する
if (process.send) {
  setInterval(() => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    process.send!({
      type: `HEARTBEAT`,
    })
  }, 1000)
}

process.on(
  `message`,
  (msg: {
    type: string
    action: { type: string; payload: number | undefined }
  }) => {
    if (msg.type === `COMMAND` && msg.action.type === `EXIT`) {
      process.exit(msg.action.payload)
    }
  }
)

interface IDevelopArgs extends IProgram {
  debugInfo: IDebugInfo | null
}

const openDebuggerPort = (debugInfo: IDebugInfo): void => {
  if (inspector.url() !== undefined) {
    return // #26708 を修正する
  }

  if (debugInfo.break) {
    inspector.open(debugInfo.port, undefined, true)
    // eslint-disable-next-line no-debugger
    debugger
  } else {
    inspector.open(debugInfo.port)
  }
}

module.exports = async (program: IDevelopArgs): Promise<void> => {
  // グローバルな Gatsby オブジェクトを用意する
  global.__GATSBY = process.env.GATSBY_NODE_GLOBALS
    ? JSON.parse(process.env.GATSBY_NODE_GLOBALS)
    : {}

  if (isTruthy(process.env.VERBOSE)) {
    program.verbose = true
  }
  reporter.setVerbose(program.verbose)

  if (program.debugInfo) {
    openDebuggerPort(program.debugInfo)
  }

  // ユーザーが develop を終了するときに、フィードバックの依頼を表示したい。
  // ただし、フィードバックを依頼したいユーザーかどうかを判定するヒューリスティックな
  // チェックを通り、かつ煩わせない場合に限る。
  process.on(`SIGINT`, async (): Promise<void> => {
    if (await userGetsSevenDayFeedback()) {
      showSevenDayFeedbackRequest()
    } else if (await userPassesFeedbackRequestHeuristic()) {
      showFeedbackRequest()
    }
    process.exit(0)
  })

  await initTracer(
    process.env.GATSBY_OPEN_TRACING_CONFIG_FILE || program.openTracingConfigFile
  )
  markWebpackStatusAsPending()
  reporter.pendingActivity({ id: `webpack-develop` })

  const port =
    typeof program.port === `string` ? parseInt(program.port, 10) : program.port
  const hostname = program.host
  try {
    program.port = await detectPortInUseAndPrompt(port, hostname)
  } catch (e) {
    if (e.message === `USER_REJECTED`) {
      process.exit(0)
    }

    throw e
  }

  const app = express()
  const parentSpan = tracer.startSpan(`bootstrap`)

  app.use((req, res, next) => {
    try {
      decodeURIComponent(req.path)
    } catch (e) {
      return res.status(500).send(`URI malformatted`)
    }

    return next()
  })

  const machine = developMachine.withContext({
    program,
    parentSpan,
    app,
    reporter,
    pendingQueryRuns: new Set([`/`]),
    shouldRunInitialTypegen: true,
  })

  const service = interpret(machine)

  if (program.verbose) {
    logTransitions(service)
  }

  service.start()
}
