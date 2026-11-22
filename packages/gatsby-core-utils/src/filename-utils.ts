import path from "path"
import crypto from "crypto"
import Url from "url"

/**
 * getParsedPath
 * --
 * リモートの URL を解析してパスオブジェクトにする
 */
function getParsedPath(url: string): path.ParsedPath {
  return path.parse(Url.parse(url).pathname || ``)
}

/**
 * getRemoteFileExtension
 * --
 * リモートの URL を解析してリモートファイルの拡張子を取得する
 */
export function getRemoteFileExtension(url: string): string {
  return getParsedPath(url).ext
}

/**
 * getRemoteFileName
 * --
 * リモートの URL を解析してリモートファイルの名前を取得する
 */
export function getRemoteFileName(url: string): string {
  return decodeURIComponent(getParsedPath(url).name)
}

export function createFileHash(input: string, length: number = 8): string {
  return crypto
    .createHash(`sha1`)
    .update(input)
    .digest(`hex`)
    .substring(0, length)
}

const filenamePurgeRegex = /:|\/|\*|\?|"|<|>|\||\\/g

/**
 * createFilePath
 * --
 * 使えない文字を `-` に置き換えたうえで、完全なファイルパスを取得する
 */
export function createFilePath(
  directory: string,
  filename: string,
  ext: string
): string {
  directory = decodeURIComponent(directory)
  filename = decodeURIComponent(filename)

  const purgedFileName = filename.replace(filenamePurgeRegex, `-`)
  const shouldAddHash = purgedFileName !== filename

  if (shouldAddHash) {
    return path.join(
      directory,
      `${purgedFileName}-${createFileHash(filename)}${ext}`
    )
  } else {
    return path.join(directory, `${filename}${ext}`)
  }
}
