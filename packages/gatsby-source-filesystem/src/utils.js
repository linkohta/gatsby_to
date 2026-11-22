const path = require(`path`)
const Url = require(`url`)
const { createFilePath } = require(`gatsby-core-utils`)

/**
 * getParsedPath
 * --
 * リモートの URL を解析してパスオブジェクトにする
 *
 *
 * @param  {String}          url
 * @return {Object}          path
 */
function getParsedPath(url) {
  return path.parse(Url.parse(url).pathname)
}

/**
 * getRemoteFileExtension
 * --
 * リモートの URL を解析してリモートファイルの拡張子を取得する
 *
 *
 * @param  {String}          url
 * @return {String}          extension
 */
export function getRemoteFileExtension(url) {
  return getParsedPath(url).ext
}

/**
 * getRemoteFileName
 * --
 * リモートの URL を解析してリモートファイルの名前を取得する
 *
 *
 * @param  {String}          url
 * @return {String}          filename
 */
export function getRemoteFileName(url) {
  return decodeURIComponent(getParsedPath(url).name)
}

// createFilePath は `gatsby-core-utils` から import すべきだが、
// すでに `gatsby-source-filesystem/utils` から import しているプラグインがあるので、
// 後方互換性のためにここで再エクスポートを残している
export { createFilePath }
