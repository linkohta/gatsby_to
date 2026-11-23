import path from "path"
import hasha from "hasha"
import fs from "fs-extra"
import pDefer from "p-defer"
import _ from "lodash"
import { createContentDigest, slash, uuid } from "gatsby-core-utils"
import reporter from "gatsby-cli/lib/reporter"
import { IPhantomReporter } from "gatsby-cli"
import {
  JobInput,
  InternalJob,
  MESSAGE_TYPES,
  IJobCreatedMessage,
  IJobCompletedMessage,
  IJobFailed,
  IJobNotWhitelisted,
  WorkerError,
} from "./types"
import { importGatsbyPlugin } from "../import-gatsby-plugin"

type IncomingMessages = IJobCompletedMessage | IJobFailed | IJobNotWhitelisted

type OutgoingMessages = IJobCreatedMessage

export { InternalJob }
export type JobResultInterface = Record<string, unknown>

let activityForJobs: IPhantomReporter | null = null
let activeJobs = 0
let isListeningForMessages = false
let hasShownIPCDisabledWarning = false

const jobsInProcess: Map<
  string,
  { id: string; deferred: pDefer.DeferredPromise<Record<string, unknown>> }
> = new Map()
const externalJobsMap: Map<
  string,
  { job: InternalJob; deferred: pDefer.DeferredPromise<any> }
> = new Map()

/**
 * ファイルシステム上に存在することを確認できるように、絶対パスを使いたい
 */
function convertPathsToAbsolute(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`${filePath} should be an absolute path.`)
  }

  return slash(filePath)
}
/**
 * ファイルの contenthash を取得する
 */
function createFileHash(path: string): string {
  return hasha.fromFileSync(path, { algorithm: `sha1` })
}

let hasActiveJobs: pDefer.DeferredPromise<void> | null = null

function hasExternalJobsEnabled(): boolean {
  return (
    process.env.ENABLE_GATSBY_EXTERNAL_JOBS === `true` ||
    process.env.ENABLE_GATSBY_EXTERNAL_JOBS === `1`
  )
}

/**
 * ローカルのワーカー関数を取得し、ユーザーのマシンで実行する
 */
async function runLocalWorker<T>(
  workerFn: { ({ inputPaths, outputDir, args }: InternalJob): T },
  job: InternalJob
): Promise<T> {
  await fs.ensureDir(job.outputDir)

  return new Promise((resolve, reject) => {
    // ワーカーを nextTick で実行する
    // TODO ここでスレッド化やキューイングを検討すべきか？
    setImmediate(() => {
      try {
        resolve(
          workerFn({
            inputPaths: job.inputPaths,
            outputDir: job.outputDir,
            args: job.args,
          } as InternalJob)
        )
      } catch (err) {
        reject(new WorkerError(err))
      }
    })
  })
}

function isJobsIPCMessage(msg: any): msg is IncomingMessages {
  return (
    msg &&
    msg.type &&
    msg.payload &&
    msg.payload.id &&
    externalJobsMap.has(msg.payload.id)
  )
}

function listenForJobMessages(): void {
  process.on(`message`, msg => {
    if (isJobsIPCMessage(msg)) {
      const { job, deferred } = externalJobsMap.get(msg.payload.id)!

      switch (msg.type) {
        case MESSAGE_TYPES.JOB_COMPLETED: {
          deferred.resolve(msg.payload.result)
          break
        }
        case MESSAGE_TYPES.JOB_FAILED: {
          deferred.reject(new WorkerError(msg.payload.error))
          break
        }
        case MESSAGE_TYPES.JOB_NOT_WHITELISTED: {
          deferred.resolve(runJob(job, true))
          break
        }
      }

      externalJobsMap.delete(msg.payload.id)
    }
  })
}

function runExternalWorker(job: InternalJob): Promise<any> {
  const deferred = pDefer<any>()

  externalJobsMap.set(job.id, {
    job,
    deferred,
  })

  const jobCreatedMessage: OutgoingMessages = {
    type: MESSAGE_TYPES.JOB_CREATED,
    payload: job,
  }

  process.send!(jobCreatedMessage)

  return deferred.promise
}

/**
 * ジョブの実行に必要なものがすべてそろっていることを確認する
 * そろっていれば、ローカルで実行する。
 * TODO ipc 経由での外部のジョブ実行を追加する
 */
function runJob(
  job: InternalJob,
  forceLocal = false
): Promise<Record<string, unknown>> {
  const { plugin } = job
  try {
    return importGatsbyPlugin(plugin, `gatsby-worker`).then(worker => {
      if (!worker[job.name]) {
        throw new Error(`No worker function found for ${job.name}`)
      }

      if (!forceLocal && !job.plugin.isLocal && hasExternalJobsEnabled()) {
        if (process.send) {
          if (!isListeningForMessages) {
            isListeningForMessages = true
            listenForJobMessages()
          }

          return runExternalWorker(job)
        } else {
          // オフロードの警告は一度だけ表示する
          if (!hasShownIPCDisabledWarning) {
            hasShownIPCDisabledWarning = true
            reporter.warn(
              `Offloading of a job failed as IPC could not be detected. Running job locally.`
            )
          }
        }
      }
      return runLocalWorker(worker[job.name], job)
    })
  } catch (err) {
    throw new Error(
      `We couldn't find a gatsby-worker.js(${plugin.resolve}/gatsby-worker.js) file for ${plugin.name}@${plugin.version}`
    )
  }
}

function isInternalJob(job: JobInput | InternalJob): job is InternalJob {
  return (
    (job as InternalJob).id !== undefined &&
    (job as InternalJob).contentDigest !== undefined
  )
}

/**
 * 内部用のジョブオブジェクトを作成する
 */
export function createInternalJob(
  job: JobInput | InternalJob,
  plugin: { name: string; version: string; resolve: string }
): InternalJob {
  // すでに情報を付加したジョブがあるようなので、この処理をやり直すべきではない
  if (isInternalJob(job)) {
    return job
  }

  const { name, inputPaths, outputDir, args } = job

  // TODO これを非同期にできないか調べる。ファイルのハッシュ計算は、待つにはコストが高いかもしれない
  // 現状では同期である必要がある。そうしないと、予約済みでまだハッシュを処理している
  // ジョブを見逃す可能性があるためである
  const inputPathsWithContentDigest = inputPaths.map((pth: string) => {
    return {
      path: convertPathsToAbsolute(pth),
      contentDigest: createFileHash(pth),
    }
  })

  const internalJob: InternalJob = {
    id: uuid.v4(),
    name,
    contentDigest: ``,
    inputPaths: inputPathsWithContentDigest,
    outputDir: convertPathsToAbsolute(outputDir),
    args,
    plugin: {
      name: plugin.name,
      version: plugin.version,
      resolve: plugin.resolve,
      isLocal: !plugin.resolve.includes(`/node_modules/`),
    },
  }

  // ファイルの内容を含むすべての引数に基づいて、contentDigest を生成する
  internalJob.contentDigest = createContentDigest({
    name: job.name,
    inputPaths: internalJob.inputPaths.map(
      inputPath => inputPath.contentDigest
    ),
    outputDir: internalJob.outputDir,
    args: internalJob.args,
    plugin: internalJob.plugin,
  })

  return internalJob
}

const activitiesForJobTypes = new Map<
  string,
  ReturnType<typeof reporter.createProgress>
>()

/**
 * ジョブを作成する
 */
export async function enqueueJob(
  job: InternalJob
): Promise<Record<string, unknown>> {
  // 実行中のジョブがすでにある場合は、同じ Promise を返す。
  // 以前の gatsby の実行で完了したジョブを返すための確認は、createJobV2 アクションに別にある
  if (jobsInProcess.has(job.contentDigest)) {
    return jobsInProcess.get(job.contentDigest)!.deferred.promise
  }

  if (activeJobs === 0) {
    hasActiveJobs = pDefer<void>()
  }

  // アクティブなジョブの数を増やす
  activeJobs++
  if (!activityForJobs) {
    activityForJobs = reporter.phantomActivity(`Running jobs v2`)
    activityForJobs!.start()
  }

  const jobType = `${job.plugin.name}.${job.name}`

  let activityForJobsProgress = activitiesForJobTypes.get(jobType)

  if (!activityForJobsProgress) {
    activityForJobsProgress = reporter.createProgress(
      `Running ${jobType} jobs`,
      1,
      0
    )
    activityForJobsProgress.start()
    activitiesForJobTypes.set(jobType, activityForJobsProgress)
  } else {
    activityForJobsProgress.total++
  }

  const deferred = pDefer<Record<string, unknown>>()
  jobsInProcess.set(job.contentDigest, {
    id: job.id,
    deferred,
  })

  try {
    const result = await runJob(job)
    // この確認は、クラウドでワーカーの結果の一貫性を保つためのものである
    if (result != null && !_.isPlainObject(result)) {
      throw new Error(
        `Result of a worker should be an object, type of "${typeof result}" was given`
      )
    }
    deferred.resolve(result)
  } catch (err) {
    deferred.reject(new WorkerError(err))
  } finally {
    // すべてのジョブが完了したら、アクティビティを終了する
    if (--activeJobs === 0) {
      hasActiveJobs!.resolve()
      activityForJobs!.end()
      // eslint-disable-next-line require-atomic-updates
      activityForJobs = null
    }

    activityForJobsProgress.tick()
  }

  return deferred.promise
}

/**
 * 進行中のジョブの Promise を取得する
 */
export function getInProcessJobPromise(
  contentDigest: string
): Promise<Record<string, unknown>> | undefined {
  return jobsInProcess.get(contentDigest)?.deferred.promise
}

/**
 * メモリー使用量を減らすために、inProgressQueue からジョブを取り除く
 */
export function removeInProgressJob(contentDigest: string): void {
  jobsInProcess.delete(contentDigest)
}

/**
 * 処理中のすべてのジョブが完了するのを待つ
 */
export async function waitUntilAllJobsComplete(): Promise<void> {
  await (hasActiveJobs ? hasActiveJobs.promise : Promise.resolve())
  for (const progressActivity of activitiesForJobTypes.values()) {
    progressActivity.end()
  }
  activitiesForJobTypes.clear()
}

/**
 * エンジン向けに、特定のジョブを待つ
 */
export async function waitJobs(jobDigests: Set<string>): Promise<void> {
  const promises: Array<Promise<any>> = []
  for (const [digest, job] of jobsInProcess) {
    if (jobDigests.has(digest)) {
      promises.push(job.deferred.promise)
    }
  }
  await Promise.all(promises)
}

export function isJobStale(
  job: Partial<InternalJob> & { inputPaths: InternalJob[`inputPaths`] }
): boolean {
  const areInputPathsStale = job.inputPaths.some(inputPath => {
    // inputPath はまだ存在するか？
    if (!fs.existsSync(inputPath.path)) {
      return true
    }

    // 同じファイルを指しているかを確認する
    const fileHash = createFileHash(inputPath.path)
    return fileHash !== inputPath.contentDigest
  })

  return areInputPathsStale
}
