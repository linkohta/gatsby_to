import { Actions, CreatePagesArgs } from "gatsby"
import {
  createPath,
  validatePath,
  ignorePath,
  IPathIgnoreOptions,
  applyTrailingSlashOption,
} from "gatsby-page-utils"
import { Options as ISlugifyOptions } from "@sindresorhus/slugify"
import { createClientOnlyPage } from "./create-client-only-page"
import { createPagesFromCollectionBuilder } from "./create-pages-from-collection-builder"
import systemPath from "path"
import { Reporter } from "gatsby/reporter"
import type { TrailingSlash } from "gatsby-page-utils"

function pathIsCollectionBuilder(path: string): boolean {
  return path.includes(`{`)
}

function pathIsClientOnlyRoute(path: string): boolean {
  return path.includes(`[`)
}

export function createPage(
  filePath: string,
  pagesDirectory: string,
  actions: Actions,
  graphql: CreatePagesArgs[`graphql`],
  reporter: Reporter,
  trailingSlash: TrailingSlash,
  pagesPath: string,
  ignore?: IPathIgnoreOptions | string | Array<string> | null,
  slugifyOptions?: ISlugifyOptions
): void {
  // ページにしてはいけない特殊なコンポーネントを
  // 取り除く。
  if (!validatePath(filePath)) {
    return
  }

  // 指定された ignore のパターンとオプションに一致するものを取り除く
  if (ignorePath(filePath, ignore)) {
    return
  }

  const absolutePath = systemPath.join(pagesDirectory, filePath)

  // ページに `{}` が含まれる場合は、コレクションビルダーとして作成する
  if (pathIsCollectionBuilder(absolutePath)) {
    createPagesFromCollectionBuilder({
      filePath,
      absolutePath,
      pagesPath,
      actions,
      graphql,
      reporter,
      trailingSlash,
      slugifyOptions,
    })
    return
  }

  // パスに `[]` が含まれる場合は、クライアント専用のルートとして作成する
  if (pathIsClientOnlyRoute(absolutePath)) {
    createClientOnlyPage(filePath, absolutePath, actions, trailingSlash)
    return
  }

  // ページオブジェクトを作成する
  const createdPath = createPath(filePath)
  const modifiedPath = applyTrailingSlashOption(createdPath, trailingSlash)
  const page = {
    path: modifiedPath,
    component: absolutePath,
    context: {},
  }

  // ページを追加する
  actions.createPage(page)
}
