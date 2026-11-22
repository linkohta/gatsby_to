// "engines-fs-provider" は最初の import でなければならない。これはグローバルな
// fs をセットアップするので、他の何かが fs を import しようとする前に行う必要がある
import "../../utils/engines-fs-provider"
import "./platform-and-arch-check"

import { getCache as getGatsbyCache } from "../../utils/get-cache"

if (!global._polyfillRemoteFileCache) {
  global._polyfillRemoteFileCache = getGatsbyCache(`gatsby`)
}
