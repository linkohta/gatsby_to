import { resolve } from "@gatsbyjs/reach-router"
// Node.js 向けのコードを tree shaking で除くため、個別に import する
import { applyTrailingSlashOption } from "gatsby-page-utils/apply-trailing-slash-option"
import { parsePath } from "./parse-path"
import { isLocalLink } from "./is-local-link"
import { withPrefix } from "./prefix-helpers"

const isAbsolutePath = path => path?.startsWith(`/`)

const getGlobalTrailingSlash = () =>
  typeof __TRAILING_SLASH__ !== `undefined` ? __TRAILING_SLASH__ : undefined

function applyTrailingSlashOptionOnPathnameOnly(path, option) {
  const { pathname, search, hash } = parsePath(path)
  const output = applyTrailingSlashOption(pathname, option)

  return `${output}${search}${hash}`
}

function absolutify(path, current) {
  // すでに絶対パスであれば、そのまま返す
  if (isAbsolutePath(path)) {
    return path
  }

  const option = getGlobalTrailingSlash()
  const absolutePath = resolve(path, current)

  if (option === `always` || option === `never`) {
    return applyTrailingSlashOptionOnPathnameOnly(absolutePath, option)
  }

  return absolutePath
}

function applyPrefix(path) {
  const prefixed = withPrefix(path)
  const option = getGlobalTrailingSlash()

  if (option === `always` || option === `never`) {
    return applyTrailingSlashOptionOnPathnameOnly(prefixed, option)
  }

  return prefixed
}

export const rewriteLinkPath = (path, relativeTo) => {
  if (typeof path === `number`) {
    return path
  }
  if (!isLocalLink(path)) {
    return path
  }

  return isAbsolutePath(path) ? applyPrefix(path) : absolutify(path, relativeTo)
}
