import { isLocalLink } from "./is-local-link"

export const getGlobalBasePrefix = () =>
  process.env.NODE_ENV !== `production`
    ? typeof __BASE_PATH__ !== `undefined`
      ? __BASE_PATH__
      : undefined
    : __BASE_PATH__

// これらのグローバルな値は、値が存在することを確かめるために typeof の条件で包んでいる。
// このコンポーネントのユニットテストでは、特に問題になる。
export const getGlobalPathPrefix = () =>
  process.env.NODE_ENV !== `production`
    ? typeof __PATH_PREFIX__ !== `undefined`
      ? __PATH_PREFIX__
      : undefined
    : __PATH_PREFIX__

export function withPrefix(path, prefix = getGlobalBasePrefix()) {
  if (!isLocalLink(path)) {
    return path
  }

  if (path.startsWith(`./`) || path.startsWith(`../`)) {
    return path
  }
  const base = prefix ?? getGlobalPathPrefix() ?? `/`

  return `${base?.endsWith(`/`) ? base.slice(0, -1) : base}${
    path.startsWith(`/`) ? path : `/${path}`
  }`
}
