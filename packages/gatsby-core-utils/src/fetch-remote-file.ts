import { fileTypeFromFile } from "file-type"
import path from "path"
import fs from "fs-extra"
import Queue from "fastq"
import { createContentDigest } from "./create-content-digest"
import {
  getRemoteFileName,
  getRemoteFileExtension,
  createFilePath,
} from "./filename-utils"
import { slash } from "./path"
import { requestRemoteNode } from "./remote-file-utils/fetch-file"
import { getStorage, getDatabaseDir } from "./utils/get-storage"
import { createMutex } from "./mutex"
import type { OptionsInit } from "got"
import type { IFetchRemoteFileOptions } from "./remote-file-utils/fetch-file"

interface ITask {
  args: IFetchRemoteFileOptions
}

const GATSBY_CONCURRENT_DOWNLOAD = process.env.GATSBY_CONCURRENT_DOWNLOAD
  ? parseInt(process.env.GATSBY_CONCURRENT_DOWNLOAD, 10) || 0
  : 50

const alreadyCopiedFiles = new Set<string>()

export type { IFetchRemoteFileOptions }

/**
 * リモートファイルをディスクへダウンロードする
 */
export async function fetchRemoteFile(
  args: IFetchRemoteFileOptions
): Promise<string> {
  // cachekey がある場合は、より多くを永続化できる
  if (args.cacheKey) {
    const storage = getStorage(getDatabaseDir())
    const info = storage.remoteFileInfo.get(args.url)

    const fileDirectory = (
      args.cache ? args.cache.directory : args.directory
    ) as string

    if (info?.cacheKey === args.cacheKey && fileDirectory) {
      const cachedPath = path.join(info.directory, info.path)
      const downloadPath = path.join(fileDirectory, info.path)

      if (await fs.pathExists(cachedPath)) {
        // キャッシュ先のディレクトリが public ディレクトリに含まれない場合は、ビルドの一部に
        // ならないのでコピーする必要はない。
        if (isPublicPath(downloadPath) && cachedPath !== downloadPath) {
          return copyCachedPathToDownloadPath({ cachedPath, downloadPath })
        }

        return cachedPath
      }
    }
  }

  return pushTask({ args })
}

function isPublicPath(downloadPath: string): boolean {
  return downloadPath.startsWith(
    path.join(global.__GATSBY?.root ?? process.cwd(), `public`)
  )
}

async function copyCachedPathToDownloadPath({
  cachedPath,
  downloadPath,
}: {
  cachedPath: string
  downloadPath: string
}): Promise<string> {
  // コピーのためにミューテックスを作る。md5 ハッシュで確認する方法もあるが、それもコストが高い
  if (!alreadyCopiedFiles.has(downloadPath)) {
    const copyFileMutex = createMutex(
      `gatsby-core-utils:copy-fetch:${downloadPath}`,
      200
    )
    await copyFileMutex.acquire()
    if (!alreadyCopiedFiles.has(downloadPath)) {
      await fs.copy(cachedPath, downloadPath, {
        overwrite: true,
      })
    }

    alreadyCopiedFiles.add(downloadPath)
    await copyFileMutex.release()
  }

  return downloadPath
}

const queue = Queue<null, ITask, string>(
  /**
   * fetchWorker
   * --
   * キューに入れられた fetch リクエストを処理する
   */
  async function fetchWorker(task, cb): Promise<void> {
    try {
      return void cb(null, await fetchFile(task.args))
    } catch (e) {
      return void cb(e)
    }
  },
  GATSBY_CONCURRENT_DOWNLOAD
)

/**
 * pushTask
 * --
 * タスクをキューと処理中のキャッシュに入れる
 *
 * キュー内のタスクを Promise 化する
 * @param {CreateRemoteFileNodePayload} task
 * @return {Promise<Buffer | string>}
 */
async function pushTask(task: ITask): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push(task, (err, node) => {
      if (!err) {
        resolve(node as string)
      } else {
        reject(err)
      }
    })
  })
}

async function fetchFile({
  url,
  cache,
  directory,
  auth = {},
  httpHeaders = {},
  ext,
  name,
  cacheKey,
  excludeDigest,
}: IFetchRemoteFileOptions): Promise<string> {
  // gatsby 4.0.0 で導入されたグローバル
  const BUILD_ID = global.__GATSBY?.buildId ?? ``
  const fileDirectory = (cache ? cache.directory : directory) as string
  const storage = getStorage(getDatabaseDir())

  if (!cache && !directory) {
    throw new Error(`You must specify either a cache or a directory`)
  }

  const fetchFileMutex = createMutex(`gatsby-core-utils:fetch:${url}`)
  await fetchFileMutex.acquire()

  // ファイルを取得する。
  try {
    const digest = createContentDigest(url)
    const finalDirectory = excludeDigest
      ? path.resolve(fileDirectory)
      : path.join(fileDirectory, digest)

    if (!name) {
      name = getRemoteFileName(url)
    }

    if (!ext) {
      ext = getRemoteFileExtension(url)
    }

    const cachedEntry = await storage.remoteFileInfo.get(url)

    const inFlightValue = getInFlightObject(url, BUILD_ID)
    if (inFlightValue) {
      const downloadPath = createFilePath(finalDirectory, name, ext)
      if (!isPublicPath(finalDirectory) || downloadPath === inFlightValue) {
        return inFlightValue
      }

      return await copyCachedPathToDownloadPath({
        cachedPath: inFlightValue,
        downloadPath: createFilePath(finalDirectory, name, ext),
      })
    }

    // htaccess 認証が渡されていれば追加する。これは拡張性があまり
    // 高くない。検証付きの適切な API を定義すべきである。
    const httpOptions: OptionsInit = {}
    if (auth && (auth.htaccess_pass || auth.htaccess_user)) {
      httpOptions.username = auth.htaccess_user
      httpOptions.password = auth.htaccess_pass
    }

    await fs.ensureDir(finalDirectory)

    const tmpFilename = createFilePath(fileDirectory, `tmp-${digest}`, ext)
    let filename = createFilePath(finalDirectory, name, ext)

    // この URL について、以前のリクエストのレスポンスヘッダーが
    // あるかを調べる。
    const headers = { ...httpHeaders }

    if (cachedEntry?.headers?.etag && (await fs.pathExists(filename))) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      headers[`If-None-Match`] = cachedEntry.headers.etag
    }

    const response = await requestRemoteNode(
      url,
      headers,
      tmpFilename,
      httpOptions
    )

    if (response.statusCode === 200) {
      // 今後のリクエストのためにレスポンスヘッダーを保存する。
      // ユーザーが拡張子を指定せず、リモートファイルからも取得できなかった場合は、推測を試みる
      if (!ext) {
        // 新しいレスポンスの場合は、拡張子を推測し、今後のために結果をキャッシュする
        const filetype = await fileTypeFromFile(tmpFilename)
        if (filetype) {
          ext = `.${filetype.ext}`

          filename += ext
        }
      }

      await fs.move(tmpFilename, filename, { overwrite: true })

      const slashedDirectory = slash(finalDirectory)
      await setInFlightObject(url, BUILD_ID, {
        cacheKey,
        extension: ext,
        headers: response.headers.etag ? { etag: response.headers.etag } : {},
        directory: slashedDirectory,
        path: slash(filename).replace(`${slashedDirectory}/`, ``),
      })
    } else if (response.statusCode === 304) {
      await fs.remove(tmpFilename)
    }

    return filename
  } finally {
    await fetchFileMutex.release()
  }
}

const inFlightMap = new Map<string, string>()
function getInFlightObject(key: string, buildId?: string): string | undefined {
  if (!buildId) {
    return inFlightMap.get(key)
  }

  const remoteFile = getStorage(getDatabaseDir()).remoteFileInfo.get(key)
  // buildId が一致すれば同じビルドであり、このビルドでこの URL はすでに処理済みである
  if (remoteFile && remoteFile.buildId === buildId) {
    return path.join(remoteFile.directory, remoteFile.path)
  }

  return undefined
}
async function setInFlightObject(
  key: string,
  buildId: string,
  value: { buildId?: string } & Omit<
    NonNullable<
      ReturnType<ReturnType<typeof getStorage>[`remoteFileInfo`][`get`]>
    >,
    `buildId`
  >
): Promise<void> {
  if (!buildId) {
    inFlightMap.set(key, path.join(value.directory, value.path))
  }

  await getStorage(getDatabaseDir()).remoteFileInfo.put(key, {
    ...value,
    buildId,
  })
}
