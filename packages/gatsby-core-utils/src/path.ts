import path from "path"
import os from "os"

/**
 * 渡されたすべてのパスセグメントを結合して変換する
 * @param paths パスセグメントの並び
 */
export function joinPath(...paths: Array<string>): string {
  const joinedPath = path.join(...paths)
  if (os.platform() === `win32`) {
    return joinedPath.replace(/\\/g, `\\\\`)
  }

  return joinedPath
}

// https://runpkg.com/?pretty-error@2.1.1/lib/nodePaths.js からコピーし、
// `^internal/` の判定を追加したもの
const nodePaths = [
  /^_debugger.js$/,
  /^_http_agent.js$/,
  /^_http_client.js$/,
  /^_http_common.js$/,
  /^_http_incoming.js$/,
  /^_http_outgoing.js$/,
  /^_http_server.js$/,
  /^_linklist.js$/,
  /^_stream_duplex.js$/,
  /^_stream_passthrough.js$/,
  /^_stream_readable.js$/,
  /^_stream_transform.js$/,
  /^_stream_writable.js$/,
  /^_tls_legacy.js$/,
  /^_tls_wrap.js$/,
  /^assert.js$/,
  /^buffer.js$/,
  /^child_process.js$/,
  /^cluster.js$/,
  /^console.js$/,
  /^constants.js$/,
  /^crypto.js$/,
  /^dgram.js$/,
  /^dns.js$/,
  /^domain.js$/,
  /^events.js$/,
  /^freelist.js$/,
  /^fs.js$/,
  /^http.js$/,
  /^https.js$/,
  /^module.js$/,
  /^net.js$/,
  /^os.js$/,
  /^path.js$/,
  /^punycode.js$/,
  /^querystring.js$/,
  /^readline.js$/,
  /^repl.js$/,
  /^smalloc.js$/,
  /^stream.js$/,
  /^string_decoder.js$/,
  /^sys.js$/,
  /^timers.js$/,
  /^tls.js$/,
  /^tty.js$/,
  /^url.js$/,
  /^util.js$/,
  /^vm.js$/,
  /^zlib.js$/,
  /^node.js$/,
  /^internal[/\\]/,
]

/**
 * ファイル名が node のパスに一致するかを調べる
 * @param fileName ファイル名
 */
export const isNodeInternalModulePath = (fileName: string): boolean =>
  nodePaths.some(regTest => regTest.test(fileName))

/**
 * Windows のバックスラッシュ区切りのパスをスラッシュ区切りに変換する: foo\\bar ➔ foo/bar
 *
 * @param  path
 * @return  スラッシュ区切りに変換したパス
 */
export function slash(path: string): string {
  const isExtendedLengthPath = /^\\\\\?\\/.test(path)

  if (isExtendedLengthPath) {
    return path
  }

  return path.replace(/\\/g, `/`)
}
