import { IGatsbyPage, IGatsbyState } from "../redux/types"
import { pick } from "@gatsbyjs/reach-router"

// 一致する最適なページを順位付けして選ぶ。それぞれのセグメントに最も高い
// 点数が付き、さらにセグメントの種類に応じて追加の点数が付く。
// その大小は次のとおり
//
//     static > dynamic > splat > root
//
// これにより、ページの順序を気にする必要がなくなり、
// コンピューターに任せられる。
//
// 将来は、この pagesByMatchPath の計算をこの関数の外へ移して、
// 処理を節約できるかもしれない
const findBestMatchingPage = (
  pages: Map<string, IGatsbyPage>,
  path: string
): IGatsbyPage | null => {
  // パフォーマンスのために、matchPath を持つルートだけを選ぶ。
  // 完全一致はすでに確認済みのはずである
  const pagesByMatchPath: Record<string, IGatsbyPage> = {}
  for (const page of pages.values()) {
    const matchPath = page.matchPath
    if (matchPath) {
      pagesByMatchPath[matchPath] = page
    }
  }

  const routes = Object.keys(pagesByMatchPath).map(path => {
    return { path }
  })

  // reach router のアルゴリズムで、最もよく一致するルートを選ぶ
  const picked = pick(routes, path)

  if (picked) {
    return pagesByMatchPath[picked.route.path]
  }

  return null
}

export function findPageByPath(
  state: IGatsbyState,
  path: string,
  fallbackTo404: boolean = false
): IGatsbyPage | undefined {
  const { pages } = state

  try {
    path = decodeURIComponent(path)
  } catch {
    // 何も処理せず、パスをそのまま使い続ける
  }

  // 最初に完全一致のパスで確認する
  let page = pages.get(path)
  if (page) {
    return page
  }

  if (path === ``) {
    // 私が試した限りでは、pathname が完全に空のリクエストを
    // 送ることはできなかったが、念のため、
    // 使える代替を試す
    page = pages.get(`/`)
    if (page) {
      return page
    }
  }
  // Gatsby はページのパスが空文字列であることを許可していないので、
  // `/` のページが見つからない場合に、"" のパスのページを
  // 取得しようとするのはスキップする
  else if (path !== `/`) {
    // 末尾と先頭のスラッシュのさまざまな組み合わせを確認する
    const hasLeadingSlash = path.startsWith(`/`)
    const hasTrailingSlash = path.endsWith(`/`)

    const bare = path.slice(
      hasLeadingSlash ? 1 : 0,
      hasTrailingSlash ? -1 : path.length
    )

    ;[bare, `/` + bare, bare + `/`, `/` + bare + `/`].some(potentialPath => {
      page = pages.get(potentialPath)
      return !!page
    })
    if (page) {
      return page
    }
  }

  // 完全一致の静的ページが見つからなかったので、matchPath を確認する
  // TODO: すべてのページをもう一度ループしないで済むように、`requires-writer` が生成する
  // `match-paths.json` を使うことを検討する。理想的には、重複する静的ページを含まない、
  // より小さい `match-paths.json` の別バージョンも `requires-writer` で生成する。
  // この関数は、この時点で静的なパスをすでに確認済みだからである
  const matchingPage = findBestMatchingPage(pages, path)

  if (matchingPage) {
    return matchingPage
  }

  if (fallbackTo404) {
    return (
      findPageByPath(state, `/dev-404-page/`, false) ??
      findPageByPath(state, `/404.html`, false)
    )
  }
  return undefined
}
