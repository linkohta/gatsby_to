import fs from "fs-extra"
import path from "path"
import { platform } from "os"
import reporter from "gatsby-cli/lib/reporter"
import {
  remove as removePageHtmlFile,
  generateHtmlPath,
  fixedPagePath,
} from "gatsby-core-utils"
import { removePageData } from "../utils/page-data"
import { store } from "../redux"
import { IGatsbyState } from "../redux/types"
import { getPageMode } from "../utils/page-mode"

const checkFolderIsEmpty = (path: string): boolean =>
  fs.existsSync(path) && !fs.readdirSync(path).length

const checkAndRemoveEmptyDir = (publicDir: string, pagePath: string): void => {
  const pageHtmlDirectory = path.dirname(generateHtmlPath(publicDir, pagePath))
  const pageDataDirectory = path.join(
    publicDir,
    `page-data`,
    fixedPagePath(pagePath)
  )
  // ページのフォルダーが空の場合は、対応する page-data フォルダーも削除する
  if (checkFolderIsEmpty(pageHtmlDirectory)) {
    fs.removeSync(pageHtmlDirectory)
  }
  if (checkFolderIsEmpty(pageDataDirectory)) {
    fs.removeSync(pageDataDirectory)
  }
}

const sortedPageKeysByNestedLevel = (pageKeys: Array<string>): Array<string> =>
  pageKeys.sort((a, b) => {
    const currentPagePathValue = a.split(`/`).length
    const previousPagePathValue = b.split(`/`).length
    return previousPagePathValue - currentPagePathValue
  })

export const removePageFiles = async (
  publicDir: string,
  pageKeys: Array<string>
): Promise<void> => {
  const removePages = pageKeys.map(pagePath => {
    const removePromise = removePageHtmlFile({ publicDir }, pagePath)
    removePromise.then(() => {
      store.dispatch({
        type: `HTML_REMOVED`,
        payload: pagePath,
      })
    })
    return removePromise
  })

  const removePageDataList = pageKeys.map(pagePath =>
    removePageData(publicDir, pagePath)
  )

  return Promise.all([...removePages, ...removePageDataList]).then(() => {
    // 削除された pageKeys をネストしたディレクトリの順に並べ替え、空であれば削除する。
    sortedPageKeysByNestedLevel(pageKeys).forEach(pagePath => {
      checkAndRemoveEmptyDir(publicDir, pagePath)
    })
  })
}

const FSisCaseInsensitive = process.env.TEST_FORCE_CASE_FS
  ? process.env.TEST_FORCE_CASE_FS === `INSENSITIVE`
  : platform() === `win32` || platform() === `darwin`
function normalizePagePath(path: string): string {
  if (path === `/`) {
    return `/`
  }

  if (FSisCaseInsensitive) {
    // たとえば、大文字と小文字を区別しないファイルシステムでは、/TEST/ と /test/ は
    // 「同じ」成果物を生成する
    path = path.toLowerCase()
  }

  return path.endsWith(`/`) ? path.slice(0, -1) : path
}

type PageGenerationAction = "delete" | "regenerate" | "reuse"
const pageGenerationActionPriority: Record<PageGenerationAction, number> = {
  // 数値が大きいほど優先度が高い
  regenerate: 2,
  reuse: 1,
  delete: 0,
}

export function calcDirtyHtmlFiles(state: IGatsbyState): {
  toRegenerate: Array<string>
  toDelete: Array<string>
  toCleanupFromTrackedState: Set<string>
} {
  const toRegenerate = new Set<string>()
  const toDelete = new Set<string>()
  const toCleanupFromTrackedState = new Set<string>()
  const normalizedPagePathToAction = new Map<
    string,
    {
      actualPath: string
      action: PageGenerationAction
    }
  >()

  /**
   * 複数のページパスが、同じ html と page-data のファイル名になることがある
   * そのため、再生成するページの一覧、そしてより重要な削除するページの一覧を
   * 生成するときに、この点を考慮する必要がある（パスが少し変わっても同じ html と
   * page-data のファイル名になる場合に、それらのファイルを削除しないようにするため。
   * たとえば、ビルドの間に、あるいは `gatsby-plugin-remove-trailing-slashes` のような
   * プラグインによってビルドの途中で、末尾のスラッシュが追加または削除される場合）。
   * さらに、大文字と小文字を区別しないファイルシステムでのページパスの大文字小文字についても、同様の考慮が必要である。
   */
  function markActionForPage(path: string, action: PageGenerationAction): void {
    const normalizedPagePath = normalizePagePath(path)

    const previousAction = normalizedPagePathToAction.get(normalizedPagePath)
    let overwritePreviousAction = false
    if (previousAction) {
      const previousActionPriority =
        pageGenerationActionPriority[previousAction.action]
      const currentActionPriority = pageGenerationActionPriority[action]

      if (currentActionPriority > previousActionPriority) {
        overwritePreviousAction = true
        toCleanupFromTrackedState.add(previousAction.actualPath)
        if (previousAction.action === `delete`) {
          // "reuse" または "regenerate" が引き継ぐので、
          // 削除するパスの一覧からパスを取り除くべきである
          toDelete.delete(previousAction.actualPath)
        }
      }
    }

    if (!previousAction || overwritePreviousAction) {
      normalizedPagePathToAction.set(normalizedPagePath, {
        actualPath: path,
        action,
      })
      if (action === `delete`) {
        toDelete.add(path)
      } else if (action === `regenerate`) {
        toRegenerate.add(path)
      }
    }
  }

  if (state.html.unsafeBuiltinWasUsedInSSR) {
    reporter.warn(
      `Previous build used unsafe builtin method. We need to rebuild all pages`
    )
  }

  state.html.trackedHtmlFiles.forEach(function (htmlFile, path) {
    const page = state.pages.get(path)
    if (htmlFile.isDeleted || !page) {
      // FIXME: ここでページの state を確認しているのは、ページが永続化されておらず、
      // そのために `isDeleted` が設定されていないことがあるからである ...
      markActionForPage(path, `delete`)
    } else {
      if (getPageMode(page, state) === `SSG`) {
        if (htmlFile.dirty || state.html.unsafeBuiltinWasUsedInSSR) {
          markActionForPage(path, `regenerate`)
        } else {
          markActionForPage(path, `reuse`)
        }
      }
    }
  })

  return {
    toRegenerate: Array.from(toRegenerate),
    toDelete: Array.from(toDelete),
    toCleanupFromTrackedState,
  }
}

export function markHtmlDirtyIfResultOfUsedStaticQueryChanged(): void {
  const state = store.getState()

  const dirtyStaticQueryResults = new Set<string>()
  state.html.trackedStaticQueryResults.forEach(
    function (staticQueryResultState, staticQueryHash) {
      if (staticQueryResultState.dirty) {
        dirtyStaticQueryResults.add(staticQueryHash)
      }
    }
  )

  // dirty な静的クエリのハッシュがある。次に、それらを使っているテンプレートを見つける必要がある
  const dirtyTemplates = new Set<string>()
  state.staticQueriesByTemplate.forEach(
    function (staticQueryHashes, componentPath) {
      for (const dirtyStaticQueryHash of dirtyStaticQueryResults) {
        if (staticQueryHashes.includes(dirtyStaticQueryHash)) {
          dirtyTemplates.add(componentPath)
          break // このテンプレートは再ビルドが必要だとすでに分かっているので、残りのクエリを確認する必要はない
        }
      }
    }
  )

  // html を dirty とマークする
  const dirtyPages = new Set<string>()
  const dirtySlices = new Set<string>()
  for (const dirtyTemplate of dirtyTemplates) {
    const component = state.components.get(dirtyTemplate)
    if (component) {
      for (const page of component.pages) {
        if (component.isSlice) {
          dirtySlices.add(page)
        } else {
          dirtyPages.add(page)
        }
      }
    }
  }

  store.dispatch({
    type: `HTML_MARK_DIRTY_BECAUSE_STATIC_QUERY_RESULT_CHANGED`,
    payload: {
      pages: dirtyPages,
      slices: dirtySlices,
      staticQueryHashes: dirtyStaticQueryResults,
    },
  })
}
