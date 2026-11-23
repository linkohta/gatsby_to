import fs from "fs"
import path from "path"
import {
  glob as globAsync,
  globSync as globSyncOriginal,
  type GlobOptionsWithFileTypesUnset,
} from "glob"
import { slash } from "gatsby-core-utils"

// glob 7 と同じ結果を返すための設定。
// glob 8 以降は、Windows でもパターンの中のバックスラッシュをエスケープとして扱う。
// このリポジトリでは `path.join` で作ったパスをパターンに使っているため、
// これまでどおりバックスラッシュをパスの区切りとして扱わせる。
function withDefaults(
  options: GlobOptionsWithFileTypesUnset
): GlobOptionsWithFileTypesUnset {
  return { windowsPathsNoEscape: true, ...options }
}

function isDirectory(file: string, cwd: string | URL | undefined): boolean {
  try {
    return fs
      .statSync(path.resolve(typeof cwd === `string` ? cwd : ``, file))
      .isDirectory()
  } catch {
    // リンク先のないシンボリックリンクなど。ディレクトリではないものとして扱う
    return false
  }
}

// glob 7 と同じ形に結果をそろえる。glob 8 以降は次の点が違う。
// - 結果が並べ替えられていない
// - Windows では、区切りがバックスラッシュのパスを返す
// - `nodir` を指定しても、ディレクトリを指すシンボリックリンクが結果に残る
function normalizeResult(
  files: Array<string>,
  options: GlobOptionsWithFileTypesUnset
): Array<string> {
  const normalized = files.map(file => slash(file))
  const withoutDirectories = options.nodir
    ? normalized.filter(file => !isDirectory(file, options.cwd))
    : normalized

  return withoutDirectories.sort((a, b) => a.localeCompare(b, `en`))
}

export function globSync(
  pattern: string,
  options: GlobOptionsWithFileTypesUnset = {}
): Array<string> {
  return normalizeResult(
    globSyncOriginal(pattern, withDefaults(options)),
    options
  )
}

export async function glob(
  pattern: string,
  options: GlobOptionsWithFileTypesUnset = {}
): Promise<Array<string>> {
  return normalizeResult(
    await globAsync(pattern, withDefaults(options)),
    options
  )
}
