import { pick } from "@gatsbyjs/reach-router"
import stripPrefix from "./strip-prefix"
import normalizePagePath from "./normalize-page-path"
import { maybeGetBrowserRedirect } from "./redirect-utils.js"

const pathCache = new Map()
let matchPaths = []

const trimPathname = rawPathname => {
  let newRawPathname = rawPathname
  const queryIndex = rawPathname.indexOf(`?`)

  if (queryIndex !== -1) {
    const [path, qs] = rawPathname.split(`?`)
    newRawPathname = `${path}?${encodeURIComponent(qs)}`
  }

  const pathname = decodeURIComponent(newRawPathname)

  // pathname から pathPrefix を取り除く。
  const trimmedPathname = stripPrefix(
    pathname,
    decodeURIComponent(__BASE_PATH__)
  )
    // ハッシュフラグメントを取り除く
    .split(`#`)[0]

  return trimmedPathname
}

function absolutify(path) {
  // すでに絶対パスであれば、そのまま返す
  if (
    path.startsWith(`/`) ||
    path.startsWith(`https://`) ||
    path.startsWith(`http://`)
  ) {
    return path
  }
  // 現在の location からの相対パスを計算する。@reach/router の挙動に
  // 合わせて末尾にスラッシュを付ける
  return new URL(
    path,
    window.location.href + (window.location.href.endsWith(`/`) ? `` : `/`)
  ).pathname
}

/**
 * matchPaths の一覧を設定する
 *
 * @param {Array<{path: string, matchPath: string}>} value matchPaths のコレクション
 */
export const setMatchPaths = value => {
  matchPaths = value
}

/**
 * matchPath の URL を返す
 * `match-paths.json` に `{ "/foo*": "/page1", ...}` が含まれている場合は
 * `/foo?bar=far` => `/page1` となる
 *
 * @param {string} rawPathname 生のパス名
 * @return {string|null}
 */
export const findMatchPath = rawPathname => {
  const trimmedPathname = cleanPath(rawPathname)

  const pickPaths = matchPaths.map(({ path, matchPath }) => {
    return {
      path: matchPath,
      originalPath: path,
    }
  })

  const path = pick(pickPaths, trimmedPathname)

  if (path) {
    return normalizePagePath(path.route.originalPath)
  }

  return null
}

/**
 * reach/router のルールに基づいて matchPath のパラメーターを返す
 * `match-paths.json` に `{ ":bar/*foo" }` が含まれていて、パスが /baz/zaz/zoo の場合は
 * 次を返す
 *  { bar: baz, foo: zaz/zoo }
 *
 * @param {string} rawPathname 生のパス名
 * @return {object}
 */
export const grabMatchParams = rawPathname => {
  const trimmedPathname = cleanPath(rawPathname)

  const pickPaths = matchPaths.map(({ path, matchPath }) => {
    return {
      path: matchPath,
      originalPath: path,
    }
  })

  const path = pick(pickPaths, trimmedPathname)

  if (path) {
    return path.params
  }

  return {}
}

// 生の URL パスを受け取り、整形したパス（`#` とクエリパラメーターを
// 取り除いたもの）を返す。`match-paths.json` のエントリーに
// 一致する場合は、一致したパスを返す
//
// 例: `/foo?bar=far` => `/foo`
//
// `match-paths.json` に `{ "/foo*": "/page1", ...}` が含まれている場合は
// `/foo?bar=far` => `/page1` となる
export const findPath = rawPathname => {
  const trimmedPathname = trimPathname(absolutify(rawPathname))
  if (pathCache.has(trimmedPathname)) {
    return pathCache.get(trimmedPathname)
  }

  const redirect = maybeGetBrowserRedirect(rawPathname)
  if (redirect) {
    return findPath(redirect.toPath)
  }

  let foundPath = findMatchPath(trimmedPathname)

  if (!foundPath) {
    foundPath = cleanPath(rawPathname)
  }

  pathCache.set(trimmedPathname, foundPath)

  return foundPath
}

/**
 * URL を整形し、/index.html を / に変換する
 * 例: `/foo?bar=far` => `/foo`
 *
 * @param {string} rawPathname 生のパス名
 * @return {string}
 */
export const cleanPath = rawPathname => {
  const trimmedPathname = trimPathname(absolutify(rawPathname))

  let foundPath = trimmedPathname
  if (foundPath === `/index.html`) {
    foundPath = `/`
  }

  foundPath = normalizePagePath(foundPath)

  return foundPath
}
