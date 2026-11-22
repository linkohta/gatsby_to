import { Actions } from "gatsby"
import {
  createPath,
  applyTrailingSlashOption,
  TrailingSlash,
} from "gatsby-page-utils"
import { getMatchPath } from "gatsby-core-utils"

// ファイルパスに含まれる `[]` をもとに、matchPath を持つ
// クライアントサイドのページを作成する。
// たとえば、`src/pages/foo/[bar].js` という名前のファイルは、
// `foo/:bar` という URL で作成される
export function createClientOnlyPage(
  filePath: string,
  absolutePath: string,
  actions: Actions,
  trailingSlash: TrailingSlash
): void {
  const path = createPath(filePath)
  const modifiedPath = applyTrailingSlashOption(path, trailingSlash)

  actions.createPage({
    path: modifiedPath,
    matchPath: getMatchPath(path),
    component: absolutePath,
    context: {},
  })
}
