import importFrom from "import-from"
import type { GatsbyCache } from "gatsby"

export function getCache(): GatsbyCache {
  if (global._polyfillRemoteFileCache) {
    return global._polyfillRemoteFileCache
  }
  // 循環依存をなくすため、import-from を使う必要がある
  const { getCache: getGatsbyCache } = importFrom(
    global.__GATSBY?.root ?? process.cwd(),
    `gatsby/dist/utils/get-cache`
  ) as { getCache: (key: string) => GatsbyCache }

  const cache = getGatsbyCache(`gatsby`)
  global._polyfillRemoteFileCache = cache
  return cache
}
