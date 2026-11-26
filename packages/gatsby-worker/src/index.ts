import { fork } from "child_process"
import fs from "fs-extra"
import os from "os"
import path from "path"

import { TaskQueue } from "./task-queue"
import {
  EXECUTE,
  END,
  ERROR,
  RESULT,
  CUSTOM_MESSAGE,
  WORKER_READY,
  ParentMessageUnion,
  ChildMessageUnion,
} from "./types"

interface IWorkerOptions {
  // 起動するワーカーの数。デフォルトは 1
  numWorkers?: number
  // ワーカー専用の環境変数
  env?: Record<string, string>
  // 出力を無視するかどうか
  silent?: boolean
}

type WrapReturnOfAFunctionInAPromise<
  FunctionThatDoesNotReturnAPromise extends (...args: Array<any>) => any,
> = (
  ...a: Parameters<FunctionThatDoesNotReturnAPromise>
) => Promise<ReturnType<FunctionThatDoesNotReturnAPromise>>

// gatsby-worker は同期関数を非同期にするので、正しい型を保つには、ワーカープール上の
// すべての関数が非同期になるよう型を調整する必要がある
type EnsureFunctionReturnsAPromise<MaybeFunction> = MaybeFunction extends (
  ...args: Array<any>
) => Promise<any>
  ? MaybeFunction
  : MaybeFunction extends (...args: Array<any>) => any
    ? WrapReturnOfAFunctionInAPromise<MaybeFunction>
    : never

type WrapReturnInArray<MaybeFunction> = MaybeFunction extends (
  ...args: Array<any>
) => any
  ? (...a: Parameters<MaybeFunction>) => Array<ReturnType<MaybeFunction>>
  : never

export type CreateWorkerPoolType<ExposedFunctions> = WorkerPool & {
  [FunctionName in keyof ExposedFunctions]: EnsureFunctionReturnsAPromise<
    ExposedFunctions[FunctionName]
  >
} & {
  all: {
    [FunctionName in keyof ExposedFunctions]: WrapReturnInArray<
      EnsureFunctionReturnsAPromise<ExposedFunctions[FunctionName]>
    >
  }
}

const childWrapperPath = require.resolve(`./child`)

class TaskInfo<T> {
  declare functionName: T
  declare args: Array<any>
  declare assignedToWorker?: IWorkerInfo<T>
  declare promise: Promise<any>
  declare resolve: (r: any) => void
  declare reject: (e: Error) => void

  constructor(opts: {
    functionName: T
    args: Array<any>
    assignedToWorker?: IWorkerInfo<T>
  }) {
    this.functionName = opts.functionName
    this.args = opts.args
    this.assignedToWorker = opts.assignedToWorker
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

interface IWorkerInfo<T> {
  workerId: number
  send: (msg: ParentMessageUnion) => void
  kill: (signal?: NodeJS.Signals | number) => boolean
  lastMessage: number
  exitedPromise: Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>
  currentTask?: TaskInfo<T>
  ready: Promise<void>
  isEnding: boolean
}

export interface IPublicWorkerInfo {
  workerId: number
}

/**
 * ワーカープールは、処理を並列化するために、複数の子プロセスにまたがって関数の実行を
 * キューに入れられるクラスである。ワーカーモジュールの絶対パスを受け取り、
 * そのモジュールが export する関数を WorkerPool インスタンスのプロパティとして公開する。
 *
 * ワーカープールでは、すべてのワーカーで関数を実行するようキューに入れること（`.all` プロパティ）も、
 * 実行をワーカーに分散させること（`.single` プロパティ）もできる
 */
export class WorkerPool<
  WorkerModuleExports = Record<string, unknown>,
  MessagesFromParent = unknown,
  MessagesFromChild = MessagesFromParent,
> {
  /**
   * すべてのワーカーでタスクの実行を予約する。ワーカーの初期設定に役立つ
   */
  declare all: {
    [FunctionName in keyof WorkerModuleExports]: WrapReturnInArray<
      EnsureFunctionReturnsAPromise<WorkerModuleExports[FunctionName]>
    >
  }

  /**
   * 1 つのワーカーでタスクの実行を予約する。複数のワーカーにタスクを分散させるのに役立つ。
   */
  declare single: {
    [FunctionName in keyof WorkerModuleExports]: EnsureFunctionReturnsAPromise<
      WorkerModuleExports[FunctionName]
    >
  }

  private workers: Array<IWorkerInfo<keyof WorkerModuleExports>> = []
  private taskQueue = new TaskQueue<TaskInfo<keyof WorkerModuleExports>>()
  private idleWorkers: Set<IWorkerInfo<keyof WorkerModuleExports>> = new Set()
  private listeners: Array<(msg: MessagesFromChild, workerId: number) => void> =
    []
  private counter = 0

  constructor(
    private workerPath: string,
    private options?: IWorkerOptions
  ) {
    const single: Partial<WorkerPool<WorkerModuleExports>[`single`]> = {}
    const all: Partial<WorkerPool<WorkerModuleExports>[`all`]> = {}

    {
      // これらは保持しておく必要がない
      const module = require(workerPath)
      const exportNames = Object.keys(module) as Array<
        keyof WorkerModuleExports
      >

      for (const exportName of exportNames) {
        if (typeof module[exportName] !== `function`) {
          // 関数だけを公開する。ほかの型を公開するには
          // 追加の処理が必要になるが、利用側は WorkerPool の
          // インターフェースではなく require/import で取得すれば済むので、
          // 対応する価値はなさそうである。
          continue
        }

        single[exportName] = this.scheduleWorkSingle.bind(
          this,
          exportName
        ) as WorkerPool<WorkerModuleExports>[`single`][typeof exportName]

        all[exportName] = this.scheduleWorkAll.bind(
          this,
          exportName
        ) as unknown as WorkerPool<WorkerModuleExports>[`all`][typeof exportName]
      }
    }

    this.single = single as WorkerPool<WorkerModuleExports>[`single`]
    this.all = all as WorkerPool<WorkerModuleExports>[`all`]
    this.startAll()
  }

  private startAll(): void {
    this.counter = 0
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `gatsby-worker`))
    const options = this.options
    for (let workerId = 1; workerId <= (options?.numWorkers ?? 1); workerId++) {
      const workerInFlightsDumpLocation = path.join(
        tmpDir,
        `worker-${workerId}.json`
      )
      const worker = fork(childWrapperPath, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...(options?.env ?? {}),
          GATSBY_WORKER_ID: workerId.toString(),
          GATSBY_WORKER_MODULE_PATH: this.workerPath,
          GATSBY_WORKER_IN_FLIGHT_DUMP_LOCATION: workerInFlightsDumpLocation,
        },
        // --debug / --inspect フラグを取り除き、それ以外（--harmony など）は残す。
        execArgv: process.execArgv.filter(v => !/^--(debug|inspect)/.test(v)),
        silent: options && options.silent,
      })

      let workerReadyResolve: () => void
      let workerExitResolve: (arg: {
        code: number | null
        signal: NodeJS.Signals | null
      }) => void

      const workerInfo: IWorkerInfo<keyof WorkerModuleExports> = {
        workerId,
        send: (msg: ParentMessageUnion): void => {
          if (!worker.connected) {
            return
          }

          worker.send(msg, undefined, undefined, error => {
            // 終了を指示した後のワーカーは、パイプが閉じてから `connected` が
            // false になるまでの間に EPIPE を返すことがある。実行中のタスクは
            // exit ハンドラーで reject されるので、このエラーは無視してよい。
            if (error && worker.connected && !workerInfo.isEnding) {
              throw error
            }
          })
        },
        kill: worker.kill.bind(worker),
        ready: new Promise<void>(resolve => {
          workerReadyResolve = resolve
        }),
        lastMessage: 0,
        exitedPromise: new Promise(resolve => {
          workerExitResolve = resolve
        }),
        isEnding: false,
      }

      const workerProcessMessageHandler = (msg: ChildMessageUnion): void => {
        if (!Array.isArray(msg)) {
          // gatsby-worker のメッセージはすべて配列のはずである
          // 配列でなければスキップする
          return
        } else if (msg[1] <= workerInfo.lastMessage) {
          // このメッセージは処理済みなのでスキップする
          // これは、ワーカーの終了を特別扱いするためのものである
          // 終了時には「送信中」の IPC メッセージを fs にシリアライズし、
          // ここで「再生」することで、メッセージが失われないようにしている
          // 難しいのは、送信中の IPC メッセージを fs に書き出しているあいだにも、
          // そのメッセージが通常の ipc メッセージとして届くことがある点である。
          // そのため、同じメッセージを 2 回処理しないようにする必要がある
          return
        } else if (msg[1] !== workerInfo.lastMessage + 1) {
          // TODO: IPC メッセージの順序が保証されるのか（されないのか）を調べる。今のところ
          // 上の条件は、IPC メッセージが、子プロセスで `process.send` によって送られたのと
          // 同じ順序で届くことを前提にしている
          // 通常、受け取るメッセージは次のもの（lastMessage + 1）であると想定している
          // 順序が保証されないのであれば、メッセージの重複排除には別の方法が
          // 必要になる。
          throw new Error(
            `[gatsby-worker] Out of order message. Expected ${
              workerInfo.lastMessage + 1
            }, got ${msg[1]}.\n\nFull message:\n${JSON.stringify(
              msg,
              null,
              2
            )}.`
          )
        }
        workerInfo.lastMessage = msg[1]
        if (msg[0] === RESULT) {
          if (!workerInfo.currentTask) {
            throw new Error(
              `Invariant: gatsby-worker received execution result, but it wasn't expecting it.`
            )
          }
          const task = workerInfo.currentTask
          workerInfo.currentTask = undefined
          this.checkForWork(workerInfo)
          task.resolve(msg[2])
        } else if (msg[0] === ERROR) {
          if (!workerInfo.currentTask) {
            throw new Error(
              `Invariant: gatsby-worker received execution rejection, but it wasn't expecting it.`
            )
          }

          let error = msg[5]

          if (error !== null && typeof error === `object`) {
            const extra = error

            const NativeCtor = global[msg[2]]
            const Ctor = typeof NativeCtor === `function` ? NativeCtor : Error

            error = new Ctor(msg[3])
            // @ts-ignore type doesn't exist on Error, but that's what jest-worker does for errors :shrug:
            error.type = msg[2]
            error.stack = msg[4]

            for (const key in extra) {
              if (Object.prototype.hasOwnProperty.call(extra, key)) {
                error[key] = extra[key]
              }
            }
          }

          const task = workerInfo.currentTask
          workerInfo.currentTask = undefined
          this.checkForWork(workerInfo)
          task.reject(error)
        } else if (msg[0] === CUSTOM_MESSAGE) {
          for (const listener of this.listeners) {
            listener(msg[2] as MessagesFromChild, workerId)
          }
        } else if (msg[0] === WORKER_READY) {
          workerReadyResolve()
        }
      }

      worker.on(`message`, workerProcessMessageHandler)
      worker.on(`exit`, async (code, signal) => {
        if (await fs.pathExists(workerInFlightsDumpLocation)) {
          const pendingMessages = await fs.readJSON(workerInFlightsDumpLocation)
          if (Array.isArray(pendingMessages)) {
            for (const msg of pendingMessages) {
              workerProcessMessageHandler(msg)
            }
          }
          try {
            await fs.remove(workerInFlightsDumpLocation)
          } catch {
            // これは単なる後始末である。中身はすでに読み込み済みで、ワーカーを起動し直すときは
            // 別の一時ディレクトリを使うため、このファイルの削除に失敗しても支障はない
          }
        }

        if (workerInfo.currentTask) {
          // ワーカーがタスクを終えないまま終了した
          workerInfo.currentTask.reject(
            new Error(`Worker exited before finishing task`)
          )
        }
        // ワーカーの一覧からワーカーを取り除く
        this.workers.splice(this.workers.indexOf(workerInfo), 1)
        workerExitResolve({ code, signal })
      })

      this.workers.push(workerInfo)
      this.idleWorkers.add(workerInfo)
    }
  }

  /**
   * ワーカープロセスを終了させ、実行中または保留中のタスクを reject する。
   * @returns 各ワーカーに対応する Promise の配列。ワーカーが終了すると解決される。
   */
  end(): Array<Promise<number | null>> {
    const results = this.workers.map(async workerInfo => {
      // ワーカーに正常終了するよう伝える
      const endMessage: ParentMessageUnion = [END, ++this.counter]

      workerInfo.isEnding = true
      workerInfo.send(endMessage)

      // ワーカーがすぐに正常終了しない場合は、強制終了する
      const forceExitTimeout = setTimeout(() => {
        workerInfo.kill(`SIGKILL`)
      }, 1000)

      const exitResult = await workerInfo.exitedPromise

      clearTimeout(forceExitTimeout)

      return exitResult.code
    })

    Promise.all(results).then(() => {
      // キューに入っているタスクも確実に失敗させる
      for (const taskNode of this.taskQueue) {
        taskNode.value.reject(new Error(`Worker exited before finishing task`))
      }
      this.workers = []
      this.idleWorkers = new Set()
    })

    return results
  }

  /**
   * 実行中のワーカープロセスをすべて終了させ、新しいプロセスのプールを起動する
   */
  async restart(): Promise<void> {
    await Promise.all(this.end())
    this.startAll()
  }

  getWorkerInfo(): Array<IPublicWorkerInfo> {
    return this.workers.map(worker => {
      return { workerId: worker.workerId }
    })
  }

  private checkForWork<T extends keyof WorkerModuleExports>(
    workerInfo: IWorkerInfo<T>
  ): void {
    // キューにタスクがあるかを確認する
    for (const taskNode of this.taskQueue) {
      const task = taskNode.value
      if (!task.assignedToWorker || task.assignedToWorker === workerInfo) {
        this.doWork(task, workerInfo)
        this.taskQueue.remove(taskNode)

        return
      }
    }

    // タスクが見つからなかったので、ワーカーをアイドル状態にする
    this.idleWorkers.add(workerInfo)
  }

  private async doWork<T extends keyof WorkerModuleExports>(
    taskInfo: TaskInfo<T>,
    workerInfo: IWorkerInfo<T>
  ): Promise<void> {
    // ワーカーをブロックする
    workerInfo.currentTask = taskInfo
    this.idleWorkers.delete(workerInfo)

    await workerInfo.ready

    const msg: ParentMessageUnion = [
      EXECUTE,
      ++this.counter,
      taskInfo.functionName,
      taskInfo.args,
    ]
    workerInfo.send(msg)
  }

  private scheduleWork<T extends keyof WorkerModuleExports>(
    taskInfo: TaskInfo<T>
  ): Promise<unknown> {
    let workerToExecuteTaskNow:
      IWorkerInfo<keyof WorkerModuleExports> | undefined

    if (taskInfo.assignedToWorker) {
      if (this.idleWorkers.has(taskInfo.assignedToWorker)) {
        workerToExecuteTaskNow = taskInfo.assignedToWorker
      }
    } else {
      workerToExecuteTaskNow = this.idleWorkers.values().next().value
    }

    if (workerToExecuteTaskNow) {
      this.doWork(taskInfo, workerToExecuteTaskNow)
    } else {
      this.taskQueue.enqueue(taskInfo)
    }

    return taskInfo.promise
  }

  private scheduleWorkSingle<T extends keyof WorkerModuleExports>(
    functionName: T,
    ...args: Array<unknown>
  ): Promise<unknown> {
    return this.scheduleWork(new TaskInfo({ functionName, args }))
  }

  private scheduleWorkAll<T extends keyof WorkerModuleExports>(
    functionName: T,
    ...args: Array<unknown>
  ): Array<Promise<unknown>> {
    return this.workers.map(workerInfo =>
      this.scheduleWork(
        new TaskInfo({ assignedToWorker: workerInfo, functionName, args })
      )
    )
  }

  onMessage(
    listener: (msg: MessagesFromChild, workerId: number) => void
  ): void {
    this.listeners.push(listener)
  }

  sendMessage(msg: MessagesFromParent, workerId: number): void {
    const worker = this.workers[workerId - 1]
    if (!worker) {
      throw new Error(`There is no worker with "${workerId}" id.`)
    }

    const poolMsg: ParentMessageUnion = [CUSTOM_MESSAGE, ++this.counter, msg]
    worker.send(poolMsg)
  }
}

export * from "./child"
