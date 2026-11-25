const fs = require(`fs-extra`)
const path = require(`path`)
const { fileTypeFromBuffer } = require(`file-type`)

const { createFileNode } = require(`./create-file-node`)
const { createContentDigest, createFilePath } = require(`gatsby-core-utils`)
const cacheId = hash => `create-file-node-from-buffer-${hash}`

/********************
 * Type Definitions *
 ********************/

/**
 * @typedef {GatsbyCache}
 * @see gatsby/packages/gatsby/utils/cache.js
 */

/**
 * @typedef {CreateFileNodeFromBufferPayload}
 * @typedef {Object}
 * @description バッファーからファイルノードを作成するためのペイロード
 *
 * @param  {Buffer} options.buffer
 * @param  {String} options.hash
 * @param  {GatsbyCache} options.cache
 * @param  {Function} options.getCache
 * @param  {Function} options.createNode
 */

/**
 * writeBuffer
 * --
 * `buffer` の内容を `filename` に書き出す
 *
 *
 * @param {String} filename
 * @param {Buffer} buffer
 * @returns {Promise<void>}
 */
const writeBuffer = (filename, buffer) =>
  new Promise((resolve, reject) => {
    fs.writeFile(filename, buffer, err => (err ? reject(err) : resolve()))
  })

/**
 * processBufferNode
 * --
 * バッファーの内容をディスクに書き出し、fileNode を返す
 *
 * @param {CreateFileNodeFromBufferPayload} options
 * @return {Promise<Object>} fileNode で解決される
 */
async function processBufferNode({
  buffer,
  hash,
  cache,
  createNode,
  parentNodeId,
  createNodeId,
  ext,
  name,
}) {
  const pluginCacheDir = cache.directory

  // このバッファーの内容に対応する、以前の実行のキャッシュファイルが
  // あるかを調べる
  let filename = await cache.get(cacheId(hash))
  if (!filename) {
    // ユーザーが拡張子を指定せず、リモートファイルからも取得できなかった場合は、
    // 推測を試みる
    if (typeof ext === `undefined`) {
      const filetype = await fileTypeFromBuffer(buffer)
      ext = filetype ? `.${filetype.ext}` : `.bin`
    }
    filename = createFilePath(path.join(pluginCacheDir, hash), name, ext)
    await fs.ensureDir(path.dirname(filename))

    // バッファーの内容をキャッシュする
    await writeBuffer(filename, buffer)

    // 今後のためにキャッシュファイルのパスを保存する
    await cache.set(cacheId(hash), filename)
  }

  // ファイルノードを作成する。
  const fileNode = await createFileNode(filename, createNodeId, {})
  fileNode.internal.description = `File "Buffer<${hash}>"`
  fileNode.hash = hash
  fileNode.parent = parentNodeId
  // デフォルトのプラグインを上書きする。gatsby-source-filesystem が
  // File ノードの所有者でなければ、gatsby-source-filesystem の通常の使い方で
  // ほかの File ノードが作成されたときに
  // 衝突するためである。
  await createNode(fileNode, { name: `gatsby-source-filesystem` })

  return fileNode
}

/**
 * バッファーのキャッシュから File ノードへ解決される Promise の索引
 */
const processingCache = {}

/***************
 * Entry Point *
 ***************/

/**
 * createFileNodeFromBuffer
 * --
 *
 * バッファーの内容をディスクにキャッシュする
 * 重複するバッファーを処理しないよう、最初にキャッシュを確認する
 *
 * @param {CreateFileNodeFromBufferPayload} options
 * @return {Promise<Object>}                  作成したノードを返す
 */
module.exports = ({
  buffer,
  hash,
  cache,
  createNode,
  getCache,
  parentNodeId = null,
  createNodeId,
  ext,
  name,
}) => {
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

  if (!buffer) {
    return Promise.reject(`bad buffer: ${buffer}`)
  }

  if (!hash) {
    hash = createContentDigest(buffer)
  }

  if (!name) {
    name = hash
  }

  // このリモートファイルのノードをすでにリクエストしたかを確認し、
  // していれば保存済みの Promise を返す。
  if (processingCache[hash]) {
    return processingCache[hash]
  }

  const bufferCachePromise = processBufferNode({
    buffer,
    hash,
    cache,
    createNode,
    parentNodeId,
    createNodeId,
    ext,
    name,
  })

  processingCache[hash] = bufferCachePromise

  return processingCache[hash]
}
