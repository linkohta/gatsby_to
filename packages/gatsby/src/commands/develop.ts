// NOTE(@mxstbr): このファイルでは reporter を使わないこと。import 時に副作用があり、構造化ログを壊すためである
import path from "path"
import tmp from "tmp"
import { ChildProcess } from "child_process"
import { execaNode } from "execa"
import { detectPortInUseAndPrompt } from "../utils/detect-port-in-use-and-prompt"
import fs from "fs-extra"
import { onExit } from "signal-exit"
import { v4 } from "gatsby-core-utils/uuid"
import { slash } from "gatsby-core-utils/path"
import reporter from "gatsby-cli/lib/reporter"
import { getSslCert } from "../utils/get-ssl-cert"
import { IProgram, IDebugInfo } from "./types"

// https://stackoverflow.com/a/16060619 を元にした
const requireUncached = (file: string): any => {
  try {
    delete require.cache[require.resolve(file)]
  } catch (e) {
    return null
  }

  try {
    return require(file)
  } catch (e) {
    return null
  }
}

// ユーザーが指定したポートを返す。なければ Node.js のデフォルトのデバッグ用ポートを返す
const getDebugPort = (port?: number): number => port ?? 9229

export const getDebugInfo = (program: IProgram): IDebugInfo | null => {
  if (Object.prototype.hasOwnProperty.call(program, `inspect`)) {
    return {
      port: getDebugPort(program.inspect),
      break: false,
    }
  } else if (Object.prototype.hasOwnProperty.call(program, `inspectBrk`)) {
    return {
      port: getDebugPort(program.inspectBrk),
      break: true,
    }
  } else {
    return null
  }
}

class ControllableScript {
  private process?: ChildProcess
  private script
  private debugInfo: IDebugInfo | null
  public isRunning
  constructor(script, debugInfo: IDebugInfo | null) {
    this.script = script
    this.debugInfo = debugInfo
  }
  start(): void {
    const args: Array<string> = []

    const dotCachePath = path.join(process.cwd(), `.cache`)
    fs.mkdirpSync(dotCachePath)
    const tmpFileName = tmp.tmpNameSync({
      tmpdir: dotCachePath,
    })
    fs.outputFileSync(tmpFileName, this.script)
    this.isRunning = true
    // 子プロセスがポートを開くために --inspect を渡す必要はないが、渡しておくと一部のエディターが自動的にアタッチできる
    if (this.debugInfo) {
      if (this.debugInfo.break) {
        args.push(`--inspect-brk=${this.debugInfo.port}`)
      } else {
        args.push(`--inspect=${this.debugInfo.port}`)
      }
    }

    const subprocess = execaNode(tmpFileName, args, {
      env: {
        ...process.env,
        GATSBY_NODE_GLOBALS: JSON.stringify(global.__GATSBY ?? {}),
      },
      stdio: `inherit`,
      ipc: true,
      // execa 5 までと同じ形式でメッセージをやり取りする
      serialization: `json`,
      // メッセージは下の `message` イベントで受け取る。execa 側に溜め込むと、
      // 長時間動かす develop でメモリを使い続けてしまう
      buffer: false,
      // 子プロセスの終了は `exit` イベントで扱う。誰も待たない Promise が
      // reject されて unhandledRejection になるのを防ぐ
      reject: false,
    })
    // execa 9 以降の戻り値は `ChildProcess` ではないので、元の `ChildProcess` を取り出す
    this.process = subprocess.nodeChildProcess
  }
  async stop(
    signal: NodeJS.Signals | null = null,
    code?: number
  ): Promise<void> {
    if (!this.process) {
      throw new Error(`Trying to stop the process before starting it`)
    }

    this.isRunning = false
    try {
      if (signal) {
        this.process.kill(signal)
      } else {
        this.process.send(
          {
            type: `COMMAND`,
            action: {
              type: `EXIT`,
              payload: code,
            },
          },
          () => {
            // この process.send には try/catch では不十分である
            // そのため、コールバックを使って Error を手動で捕捉する。そうしないと例外が投げられる
            // 参考: https://nodejs.org/api/child_process.html#child_process_subprocess_send_message_sendhandle_options_callback
          }
        )
      }
    } catch (err) {
      // プロセスがクラッシュした、またはすでに終了している場合は、エラーを無視する。
      // 参考: https://github.com/gatsbyjs/gatsby/issues/28011#issuecomment-877302917
    }

    return new Promise(resolve => {
      if (!this.process) {
        throw new Error(`Trying to stop the process before starting it`)
      }

      this.process.on(`exit`, () => {
        if (this.process) {
          this.process.removeAllListeners()
        }
        this.process = undefined
        resolve()
      })
    })
  }
  onMessage(callback: (msg: any) => void): void {
    if (!this.process) {
      throw new Error(`Trying to attach message handler before process started`)
    }
    this.process.on(`message`, callback)
  }
  onExit(
    callback: (code: number | null, signal: NodeJS.Signals | null) => void
  ): void {
    if (!this.process) {
      throw new Error(`Trying to attach exit handler before process started`)
    }
    this.process.on(`exit`, callback)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(msg: any): void {
    if (!this.process) {
      throw new Error(`Trying to send a message before process started`)
    }

    this.process.send(msg)
  }
}

let isRestarting

// 文字列が有効な IP かどうかを確認する
const REGEX_IP =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$/

module.exports = async (program: IProgram): Promise<void> => {
  global.__GATSBY = {
    buildId: v4(),
    root: program.directory,
  }

  // 場合によっては、port が実際には文字列のことがある。しかし、コードベースは数値であることを期待している。
  // そのため、常に正しい型で処理できるよう、早い段階で数値に変換しておく。
  program.port = parseInt(program.port + ``, 10)
  const developProcessPath = slash(require.resolve(`./develop-process`))

  try {
    program.port = await detectPortInUseAndPrompt(program.port, program.host)
  } catch (e) {
    if (e.message === `USER_REJECTED`) {
      process.exit(0)
    }

    throw e
  }

  // 実際の develop サーバーはランダムなポートで実行し、プロキシを program のポートで実行する。
  // ユーザーがアクセスするのは後者である
  const debugInfo = getDebugInfo(program)

  const rootFile = (file: string): string => path.join(program.directory, file)

  // ユーザーが設定ファイルから環境変数を変更できるよう、process.env にアクセスする前に
  // gatsby-config.js を require する。
  requireUncached(rootFile(`gatsby-config`))

  const developPort = program.port

  // 独自の SSL を有効にするには、--cert-file、--key-file、-https の各フラグを
  // すべて一緒に使う必要がある
  if ((program[`cert-file`] || program[`key-file`]) && !program.https) {
    reporter.panic(
      `for custom ssl --https, --cert-file, and --key-file must be used together`
    )
  }

  // https が有効かどうかを確認し、有効であれば SSL 証明書を作成または取得する。
  // 証明書は 'devcert' という名前で、ホストに対して発行される。
  // NOTE(@mxstbr): program.ssl は、上の develop プロセスを制御するスクリプトへ
  // 渡した _後で_ 変更する。そうしないと、ブラウザー => プロキシ => サーバーの
  // 間で SSL が二重になってしまうためである
  if (program.https) {
    const sslHost =
      program.host === `0.0.0.0` || program.host === `::`
        ? `localhost`
        : program.host

    if (REGEX_IP.test(sslHost)) {
      reporter.panic(
        `You're trying to generate a ssl certificate for an IP (${sslHost}). Please use a hostname instead.`
      )
    }

    const ssl = await getSslCert({
      name: sslHost,
      caFile: program[`ca-file`],
      certFile: program[`cert-file`],
      keyFile: program[`key-file`],
      directory: program.directory,
    })

    if (ssl) {
      program.ssl = ssl
    }
  }

  const developProcess = new ControllableScript(
    `
    const cmd = require(${JSON.stringify(developProcessPath)});
    const args = ${JSON.stringify({
      ...program,
      port: developPort,
      // TODO(v5): 削除する
      proxyPort: developPort,
      debugInfo,
    })};
    cmd(args);
  `,
    debugInfo
  )

  const handleChildProcessIPC = (msg): void => {
    if (msg.type === `HEARTBEAT`) return
    if (process.send) {
      // IPC を転送する
      process.send(msg)
    }
  }

  developProcess.start()
  developProcess.onMessage(handleChildProcessIPC)

  // プラグインが `process.exit` を呼ぶことがあり、それは `develop-process`（子プロセス）に送られる
  // これを親プロセスへ伝える必要がある
  developProcess.onExit(
    (code: number | null, signal: NodeJS.Signals | null) => {
      if (isRestarting) return
      if (signal !== null) {
        process.kill(process.pid, signal)
        return
      }
      if (code !== null) {
        process.exit(code)
      }

      // これは起こらないはずである:
      // https://nodejs.org/api/child_process.html#child_process_event_exit
      // 'exit' イベントは子プロセスの終了後に emit される。プロセスが
      // 終了した場合、code はプロセスの最終的な終了コードになり、そうでなければ null になる。
      // プロセスがシグナルの受信によって終了した場合、signal はシグナルの
      // 文字列名になり、そうでなければ null になる。2 つのうちどちらかは必ず
      // null ではない。
      //
      // ただし、念のため 0 以外で終了させる。起こりうると想定していない
      // 状況にいるためである
      process.exit(1)
    }
  )

  // IPC のメッセージを元の develop プロセスへ転送する
  process.on(`message`, msg => {
    developProcess.send(msg)
  })

  process.on(`SIGINT`, async () => {
    await shutdownServices(
      {
        developProcess,
      },
      `SIGINT`
    )

    process.exit(0)
  })

  process.on(`SIGTERM`, async () => {
    await shutdownServices(
      {
        developProcess,
      },
      `SIGTERM`
    )

    process.exit(0)
  })

  onExit((_code, signal) => {
    shutdownServices(
      {
        developProcess,
      },
      signal as NodeJS.Signals
    )
  })
}

interface IShutdownServicesOptions {
  developProcess: ControllableScript
}

function shutdownServices(
  { developProcess }: IShutdownServicesOptions,
  signal: NodeJS.Signals
): Promise<void> {
  const services = [developProcess.stop(signal)]

  return Promise.all(services)
    .catch(() => {})
    .then(() => {})
}
