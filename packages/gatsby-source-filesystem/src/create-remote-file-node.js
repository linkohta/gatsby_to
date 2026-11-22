const { fetchRemoteFile } = require(`gatsby-core-utils/fetch-remote-file`)
const { isWebUri } = require(`valid-url`)
const { createFileNode } = require(`./create-file-node`)

/********************
 * Type Definitions *
 ********************/

/**
 * @typedef {GatsbyCache}
 * @see gatsby/packages/gatsby/utils/cache.js
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
 */

/******************
 * Core Functions *
 ******************/

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
  const filename = await fetchRemoteFile({
    url,
    cache,
    auth,
    httpHeaders,
    ext,
    name,
  })

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
module.exports = function createRemoteFileNode({
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
}) {
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
    throw new Error(
      `url passed to createRemoteFileNode is either missing or not a proper web uri: ${url}`
    )
  }

  const fileDownloadPromise = processRemoteNode({
    url,
    cache,
    createNode,
    parentNodeId,
    createNodeId,
    auth,
    httpHeaders,
    ext,
    name,
  })

  processingCache[url] = fileDownloadPromise.then(node => node)

  return processingCache[url]
}
