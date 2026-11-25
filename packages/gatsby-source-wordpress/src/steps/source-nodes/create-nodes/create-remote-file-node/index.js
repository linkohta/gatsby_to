import { b64e } from "~/utils/string-encoding"
import { withPluginKey } from "~/store"
const fs = require(`fs-extra`)
const { remoteFileDownloaderBarPromise } = require(`./progress-bar-promise`)
const { default: got } = require(`got`)
const { createContentDigest } = require(`gatsby-core-utils`)
const path = require(`path`)
const { isWebUri } = require(`valid-url`)
const Queue = require(`better-queue`)
const readChunk = require(`read-chunk`)
const { fileTypeFromBuffer, reasonableDetectionSizeInBytes } = require(
  `file-type`
)

const { createFileNode } = require(`gatsby-source-filesystem/create-file-node`)
const { getRemoteFileExtension, getRemoteFileName, createFilePath } = require(
  `gatsby-source-filesystem/utils`
)
const cacheId = url => withPluginKey(`create-remote-file-node-${url}`)

let bar
// キューに追加したジョブの総数を記録する
let totalJobs = 0

/********************
 * Type Definitions *
 ********************/

/**
 * @typedef {GatsbyCache}
 * @see gatsby/packages/gatsby/utils/cache.js
 */

/**
 * @typedef {Reporter}
 * @see gatsby/packages/gatsby-cli/lib/reporter.js
 */

/**
 * @typedef {Auth}
 * @type {Object}
 * @property {String} htaccess_pass
 * @property {String} htaccess_user
 */

/**
 * @typedef {CreateRemoteFileNodePayload}
 * @typedef {Object}
 * @description リモートファイルのノードを作成するためのペイロード
 *
 * @param  {String} options.url
 * @param  {GatsbyCache} options.cache
 * @param  {Function} options.createNode
 * @param  {Function} options.getCache
 * @param  {Auth} [options.auth]
 * @param  {Reporter} [options.reporter]
 */

const STALL_RETRY_LIMIT = process.env.GATSBY_STALL_RETRY_LIMIT
  ? parseInt(process.env.GATSBY_STALL_RETRY_LIMIT, 10)
  : 3
const STALL_TIMEOUT = process.env.GATSBY_STALL_TIMEOUT
  ? parseInt(process.env.GATSBY_STALL_TIMEOUT, 10)
  : 30000

const CONNECTION_TIMEOUT = process.env.GATSBY_CONNECTION_TIMEOUT
  ? parseInt(process.env.GATSBY_CONNECTION_TIMEOUT, 10)
  : 30000

/********************
 * Queue Management *
 ********************/

/**
 * キュー
 * タスクの URL を id として使う
 * 同じ id のタスクを追加するときは、元のタスクを優先する
 * すでに処理中のキャッシュに入っているためである
 */

let queue = null

const getQueue = limit => {
  if (!queue) {
    queue = new Queue(pushToQueue, {
      id: `url`,
      merge: (old, _, cb) => cb(old),
      concurrent: limit || 100,
    })
    // キューが空になったらプログレスバーを止める
    queue.on(`drain`, async () => {
      if (awaitingCreateRemoteFileNodePromise) {
        return
      }

      awaitingCreateRemoteFileNodePromise = true
      await remoteFileDownloaderBarPromise
      awaitingCreateRemoteFileNodePromise = false

      if (bar) {
        // 少し間を置いて、さらにジョブが追加されるかどうかを
        // しばらく待つためのものである
        // キューが空になっても、2 秒以内に作り直されることがある
        doneQueueTimeout = setTimeout(() => {
          bar.done()
          totalJobs = 0
        }, 2000)
      }
    })
  }
  return queue
}

let doneQueueTimeout

let awaitingCreateRemoteFileNodePromise

/**
 * @callback {Queue~queueCallback}
 * @param {*} error
 * @param {*} result
 */

/**
 * pushToQueue
 * --
 * キューに追加されたタスクを処理する
 *
 *
 * @param  {CreateRemoteFileNodePayload}          task
 * @param  {Queue~queueCallback}  cb
 * @return {Promise<null>}
 */
async function pushToQueue(task, cb) {
  try {
    const node = await processRemoteNode(task)
    return cb(null, node)
  } catch (e) {
    return cb(e)
  }
}

/******************
 * Core Functions *
 ******************/

/**
 * requestRemoteNode
 * --
 * 要求されたファイルをダウンロードする
 *
 * @param  {String}   url
 * @param  {Headers}  headers
 * @param  {String}   tmpFilename
 * @param  {Object}   httpOpts
 * @param  {number}   attempt
 * @return {Promise<Object>}  [http Result Object]{@link https://nodejs.org/api/http.html#http_class_http_serverresponse} で解決される
 */
const requestRemoteNode = (url, headers, tmpFilename, httpOpts, attempt = 1) =>
  new Promise((resolve, reject) => {
    let timeout

    // データを何も受信しないまま止まった場合に呼ばれる
    const handleTimeout = async () => {
      fsWriteStream.close()
      fs.removeSync(tmpFilename)
      if (attempt < STALL_RETRY_LIMIT) {
        // 自分自身を再帰的に呼び出してリトライする
        resolve(
          requestRemoteNode(url, headers, tmpFilename, httpOpts, attempt + 1)
        )
      } else {
        processingCache[url] = null
        totalJobs -= 1
        bar.total = totalJobs
        reject(
          new Error(
            `Failed to download ${url} after ${STALL_RETRY_LIMIT} attempts`
          )
        )
      }
    }

    const resetTimeout = () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      timeout = setTimeout(handleTimeout, STALL_TIMEOUT)
    }

    const responseStream = got.stream(url, {
      headers,
      timeout: { send: CONNECTION_TIMEOUT },
      ...httpOpts,
    })
    const fsWriteStream = fs.createWriteStream(tmpFilename)
    responseStream.pipe(fsWriteStream)

    // 400/500 のレスポンスやその他のエラーがあった場合。
    responseStream.on(`error`, error => {
      if (timeout) {
        clearTimeout(timeout)
      }
      processingCache[url] = null
      totalJobs -= 1
      bar.total = totalJobs
      fs.removeSync(tmpFilename)
      console.error(error)
      reject(error)
    })

    fsWriteStream.on(`error`, error => {
      if (timeout) {
        clearTimeout(timeout)
      }
      processingCache[url] = null
      totalJobs -= 1
      bar.total = totalJobs
      reject(error)
    })

    responseStream.on(`response`, response => {
      resetTimeout()

      fsWriteStream.on(`finish`, () => {
        if (timeout) {
          clearTimeout(timeout)
        }
        resolve(response)
      })
    })
  })

/**
 * processRemoteNode
 * --
 * リモートファイルをリクエストし、fileNode を返す
 *
 * @param {CreateRemoteFileNodePayload} options
 * @return {Promise<Object>} fileNode で解決される
 */
async function processRemoteNode({
  url,
  cache,
  createNode,
  parentNodeId,
  auth = {},
  httpHeaders = {},
  createNodeId,
  ext,
  name,
}) {
  const pluginCacheDir = cache.directory
  // この URL について、以前のリクエストのレスポンスヘッダーが
  // あるかを調べる。
  const cachedHeaders = await cache.get(cacheId(url))

  const headers = { ...httpHeaders }
  if (cachedHeaders && cachedHeaders.etag) {
    headers[`If-None-Match`] = cachedHeaders.etag
  }

  // htaccess 認証が渡されていれば追加する。これは拡張性があまり
  // 高くない。検証付きの適切な API を定義すべきである。
  const httpOpts = {}
  if (auth?.htaccess_pass && auth?.htaccess_user) {
    headers[`Authorization`] = `Basic ${b64e(
      `${auth.htaccess_user}:${auth.htaccess_pass}`
    )}`
  }

  // この URL に対応する一時ファイル名と永続ファイル名を作成する。
  const digest = createContentDigest(url)
  if (!name) {
    name = getRemoteFileName(url)
  }
  if (!ext) {
    ext = getRemoteFileExtension(url)
  }

  const tmpFilename = createFilePath(pluginCacheDir, `tmp-${digest}`, ext)

  // ファイルを取得する。
  const response = await requestRemoteNode(url, headers, tmpFilename, httpOpts)

  if (response.statusCode == 200) {
    // 今後のリクエストのためにレスポンスヘッダーを保存する。
    await cache.set(cacheId(url), response.headers)
  }

  // ユーザーが拡張子を指定せず、リモートファイルからも取得できなかった場合は、推測を試みる
  if (ext === ``) {
    const buffer = readChunk.sync(
      tmpFilename,
      0,
      reasonableDetectionSizeInBytes
    )
    const filetype = await fileTypeFromBuffer(buffer)
    if (filetype) {
      ext = `.${filetype.ext}`
    }
  }

  const filename = createFilePath(
    path.join(pluginCacheDir, digest),
    String(name),
    ext
  )

  // ステータスコードが 200 であれば、パイプで書き出した一時ファイルを本来の名前へ移動する。
  if (response.statusCode === 200) {
    await fs.move(tmpFilename, filename, { overwrite: true })
    // 304 であれば、空のレスポンスを削除する。
  } else {
    processingCache[url] = null
    totalJobs -= 1

    bar.total = totalJobs

    await fs.remove(tmpFilename)
  }

  // ファイルノードを作成する。
  const fileNode = await createFileNode(filename, createNodeId, {})
  fileNode.internal.description = `File "${url}"`
  fileNode.url = url
  fileNode.parent = parentNodeId
  // デフォルトのプラグインを上書きする。gatsby-source-filesystem が
  // File ノードの所有者でなければ、gatsby-source-filesystem の通常の使い方で
  // ほかの File ノードが作成されたときに
  // 衝突するためである。
  await createNode(fileNode, { name: `gatsby-source-filesystem` })

  return fileNode
}

/**
 * リモートの URL から File ノードへ解決される Promise の索引
 */
const processingCache = {}
/**
 * pushTask
 * --
 * タスクをキューと処理中のキャッシュに入れる
 *
 * キュー内のタスクを Promise 化する
 * @param {CreateRemoteFileNodePayload} task
 * @return {Promise<Object>}
 */
const pushTask = task =>
  new Promise((resolve, reject) => {
    getQueue(task.limit)
      .push(task)
      .on(`finish`, task => {
        resolve(task)
      })
      .on(`failed`, err => {
        reject(new Error(`failed to process ${task.url}\n${err}`))
      })
  })

/***************
 * Entry Point *
 ***************/

/**
 * createRemoteFileNode
 * --
 *
 * リモートファイルをダウンロードする
 * 重複するリクエストを処理しないよう、最初にキャッシュを確認する
 * その後、キューに追加する
 *
 * @param {CreateRemoteFileNodePayload} options
 * @return {Promise<Object>}                  作成したノードを返す
 */
module.exports = ({
  url,
  cache,
  createNode,
  getCache,
  parentNodeId = null,
  auth = {},
  httpHeaders = {},
  createNodeId,
  ext = null,
  name = null,
  reporter,
  pluginOptions,
}) => {
  const limit = pluginOptions?.type?.MediaItem?.localFile?.requestConcurrency
  if (doneQueueTimeout) {
    // ファイルのダウンロードの合間に間が空いたときに、プログレスバーが
    // 少し待てるようにするためのものである。
    clearTimeout(doneQueueTimeout)
  }

  // URL がまだエンコードされていない場合
  // （デコードしても何も変わらない場合）
  if (decodeURI(url) === url) {
    // URI をエンコードする
    // ファイル名に含まれる特殊文字に対応するためである
    url = encodeURI(url)
  }

  // 入力の検証
  // これがないと、誤った `createNodeId` を渡してしまうことが非常に多い
  // gatsbyjs/gatsby#6643 を参照
  if (typeof createNodeId !== `function`) {
    throw new Error(
      `createNodeId must be a function, was ${typeof createNodeId}`
    )
  }
  if (typeof createNode !== `function`) {
    throw new Error(`createNode must be a function, was ${typeof createNode}`)
  }
  if (typeof getCache === `function`) {
    // 関数の呼び出し元のキャッシュではなく、このプラグインのキャッシュを使う
    cache = getCache(`gatsby-source-filesystem`)
  }
  if (typeof cache !== `object`) {
    throw new Error(
      `Neither "cache" or "getCache" was passed. getCache must be function that return Gatsby cache, "cache" must be the Gatsby cache, was ${typeof cache}`
    )
  }

  // このリモートファイルのノードをすでにリクエストしたかを確認し、
  // していれば保存済みの Promise を返す。
  if (processingCache[url]) {
    return processingCache[url]
  }

  if (!url || isWebUri(url) === undefined) {
    return Promise.reject(
      new Error(
        `url passed to create-remote-file-node is either missing or not a proper web uri: ${url}`
      )
    )
  }

  if (totalJobs === 0) {
    bar = reporter.createProgress(`Downloading remote files`)
    bar.start()
  }

  totalJobs += 1

  bar.total = totalJobs

  const fileDownloadPromise = pushTask({
    url,
    cache,
    createNode,
    parentNodeId,
    createNodeId,
    auth,
    httpHeaders,
    ext,
    name,
    limit,
  })

  processingCache[url] = fileDownloadPromise.then(node => {
    bar.tick()

    return node
  })

  return processingCache[url]
}
