import * as nodePath from "path"
import anymatch, { Matcher, Tester } from "anymatch"
import globParent from "glob-parent"
import isGlob from "is-glob"
import braces from "braces"

// chokidar は 4 で glob の監視をやめたので、chokidar 3 が glob に対して行っていた処理
// （glob の親フォルダーを監視し、glob に合わないファイルと、たどる必要のないフォルダーを除く）を
// `ignored` に渡す関数として再現する。照合の規則を変えないために、chokidar 3 と同じ
// ライブラリ（anymatch、glob-parent、is-glob、braces）を使っている。

// chokidar 3 と同じく、ドットで始まるファイルも glob に一致させる
const ANYMATCH_OPTIONS = { dot: true }
const GLOBSTAR = `**`
const NEGATION = `!`
const PATH_SEPARATORS = /[/\\]/

interface IFileSystemStats {
  isDirectory: () => boolean
}

interface IWatchEntry {
  path: string
  // glob のときだけ持つ
  glob?: {
    watchPath: string
    matchesFile: (path: string) => boolean
    directoryParts: Array<Array<string>>
  }
}

export interface IGlobWatchFilterOptions {
  // chokidar に渡す `cwd` と同じ値
  cwd?: string
  // chokidar 3 の `ignored` と同じ形式（glob、正規表現、関数、またはその配列）
  ignored?: Matcher
}

export interface IGlobWatchFilter {
  /**
   * 監視したいパスや glob を登録し、chokidar の `watch()` や `add()` に渡すパスを返す。
   * glob は、その親フォルダーに置き換わる。
   */
  add: (paths: string | ReadonlyArray<string>) => Array<string>
  /**
   * chokidar の `ignored` オプションに渡す関数。
   */
  ignored: (path: string, stats?: IFileSystemStats) => boolean
}

const toUnix = (path: string): string =>
  path.replace(/\\/g, `/`).replace(/\/+/g, `/`)

const normalizeToUnix = (path: string): string =>
  toUnix(nodePath.normalize(toUnix(path)))

const isSameOrInside = (parent: string, child: string): boolean => {
  const relative = nodePath.relative(parent, child)

  return (
    relative === `` ||
    (!relative.startsWith(`..`) && !nodePath.isAbsolute(relative))
  )
}

const getDirectoryParts = (
  glob: string,
  watchPath: string
): Array<Array<string>> => {
  const expanded = glob.includes(`{`) ? braces.expand(glob) : [glob]

  return expanded.map(expandedGlob =>
    nodePath.relative(watchPath, expandedGlob).split(PATH_SEPARATORS)
  )
}

export function createGlobWatchFilter({
  cwd,
  ignored,
}: IGlobWatchFilterOptions = {}): IGlobWatchFilter {
  const entries: Array<IWatchEntry> = []
  const negatedPaths: Array<string> = []

  const ignoredList = ignored === undefined ? [] : [ignored].flat()
  const normalizedIgnored = ignoredList.map(matcher =>
    typeof matcher === `string`
      ? normalizeToUnix(
          nodePath.isAbsolute(matcher)
            ? matcher
            : nodePath.join(cwd ?? ``, matcher)
        )
      : matcher
  )
  // glob ではない文字列は、そのパスの配下もすべて無視する
  const ignoredDescendants = normalizedIgnored
    .filter(
      (matcher): matcher is string =>
        typeof matcher === `string` && !isGlob(matcher)
    )
    .map(matcher => `${matcher}/${GLOBSTAR}`)

  let isUserIgnored: Tester | undefined

  const getIsUserIgnored = (): Tester => {
    if (!isUserIgnored) {
      isUserIgnored = anymatch(
        [...negatedPaths, ...normalizedIgnored, ...ignoredDescendants],
        null,
        ANYMATCH_OPTIONS
      )
    }

    return isUserIgnored
  }

  const add = (paths: string | ReadonlyArray<string>): Array<string> => {
    const watchPaths: Array<string> = []

    for (let path of [paths].flat()) {
      if (cwd) {
        if (path.startsWith(NEGATION)) {
          path = NEGATION + nodePath.join(cwd, path.slice(1))
        } else {
          const absolutePath = nodePath.isAbsolute(path)
            ? path
            : nodePath.join(cwd, path)
          // `cwd` の部分は glob になりえないので、元のパスで判定する
          path = isGlob(path) ? normalizeToUnix(absolutePath) : absolutePath
        }
      }

      // `!` で始まるパスは、監視せずに無視する側へ回す
      if (path.startsWith(NEGATION)) {
        negatedPaths.push(normalizeToUnix(path.slice(1)))
        isUserIgnored = undefined
        continue
      }

      if (!isGlob(path)) {
        entries.push({ path })
        watchPaths.push(path)
        continue
      }

      const watchPath = globParent(path)
      const directoryParts = getDirectoryParts(path, watchPath)
      // 最後の要素はファイル名にあたるので、フォルダーの照合には使わない
      directoryParts.forEach(parts => {
        if (parts.length > 1) {
          parts.pop()
        }
      })

      entries.push({
        path,
        glob: {
          watchPath,
          matchesFile: anymatch(path, null, ANYMATCH_OPTIONS),
          directoryParts,
        },
      })
      watchPaths.push(watchPath)
    }

    return watchPaths
  }

  const acceptsFile = (entry: IWatchEntry, path: string): boolean =>
    entry.glob ? entry.glob.matchesFile(path) : isSameOrInside(entry.path, path)

  const acceptsDirectory = (entry: IWatchEntry, path: string): boolean => {
    if (!entry.glob) {
      // 監視対象の上位のフォルダーは、対象が後から作られたときに気付けるように残す
      return (
        isSameOrInside(entry.path, path) || isSameOrInside(path, entry.path)
      )
    }

    const { watchPath, directoryParts } = entry.glob

    if (isSameOrInside(path, watchPath)) {
      return true
    }
    if (!isSameOrInside(watchPath, path)) {
      return false
    }

    // glob のフォルダー部分に合わないフォルダーには入らない。
    // これがないと、たとえば `<root>/.env*` のためにサイト全体（`node_modules` を含む）を
    // 監視することになる。
    const pathParts = nodePath.relative(watchPath, path).split(PATH_SEPARATORS)
    let hasGlobstar = false

    return directoryParts.some(parts =>
      parts.every((part, index) => {
        if (part === GLOBSTAR) {
          hasGlobstar = true
        }

        return (
          hasGlobstar ||
          !pathParts[index] ||
          anymatch(part, null, ANYMATCH_OPTIONS)(pathParts[index])
        )
      })
    )
  }

  const isIgnored = (path: string, stats?: IFileSystemStats): boolean => {
    const absolutePath =
      cwd && !nodePath.isAbsolute(path) ? nodePath.join(cwd, path) : path

    if (getIsUserIgnored()([absolutePath, stats])) {
      return true
    }

    if (entries.length === 0) {
      return false
    }

    if (!stats) {
      // 種類が分からないとき（削除の通知など）は、ファイルとしてもフォルダーとしても
      // 対象になりえない場合だけ無視する
      return !entries.some(
        entry =>
          acceptsFile(entry, absolutePath) ||
          acceptsDirectory(entry, absolutePath)
      )
    }

    return stats.isDirectory()
      ? !entries.some(entry => acceptsDirectory(entry, absolutePath))
      : !entries.some(entry => acceptsFile(entry, absolutePath))
  }

  return { add, ignored: isIgnored }
}
