import { minimatch } from "minimatch"

export const REPORTER_PREFIX = `[gatsby-plugin-sitemap]:`

/**
 *
 * @param {string} path
 * @returns {string}
 */
export const withoutTrailingSlash = path =>
  path === `/` ? path : path.replace(/\/$/, ``)

/**
 * @name prefixPath
 *
 * 相対パスに、サイトのドメイン、Gatsby の pathPrefix、AssetPrefix を正しく付ける
 *
 * @param {string} url - 相対パスを含む文字列
 * @param {string} siteUrl - resolveSiteUrl 関数の結果
 * @returns {string}
 */
// TODO: v3 向けに更新する - 不安定なパスとアセットのプレフィックス処理を修正する
export function prefixPath({ url, siteUrl, pathPrefix = `` }) {
  return new URL(pathPrefix + url, siteUrl).toString()
}

/**
 * @name resolveSiteUrl
 *
 * @param {object} data - GraphQL クエリの結果
 * @returns {string} - サイトの URL。graphql クエリから得ることも、別のスコープから得ることもできる
 */
export function resolveSiteUrl(data) {
  if (!data?.site?.siteMetadata?.siteUrl) {
    throw Error(
      `\`siteUrl\` does not exist on \`siteMetadata\` in the data returned from the query.
Add this to your \`siteMetadata\` object inside gatsby-config.js or add this to your custom query or provide a custom \`resolveSiteUrl\` function.
https://www.gatsbyjs.com/plugins/gatsby-plugin-sitemap/#api-reference
      `
    )
  }

  return data.site.siteMetadata.siteUrl
}
/**
 * @name resolvePagePath
 *
 * URI を "path" に置きたくない場合は、resolvePagePath が
 * 必要になる。
 *
 * @param {object} page - resolvePages が返した配列の要素
 * @returns {string} - ドメインとプロトコルを除いたページの uri
 */

export function resolvePagePath(page) {
  if (!page?.path) {
    throw Error(
      `\`path\` does not exist on your page object.
Make the page URI available at \`path\` or provide a custom \`resolvePagePath\` function.
https://www.gatsbyjs.com/plugins/gatsby-plugin-sitemap/#api-reference
      `
    )
  }

  return page.path
}
/**
 * @name resolvePages
 *
 * ページの配列を独自の方法で解決できるようにする。
 * 必要であれば、ユーザーはここで複数のソースを
 * 1 つの配列にまとめることもできる。
 *
 * @param {object} data - GraphQL クエリの結果
 * @returns {Array} - 各ページを表すオブジェクトの配列
 */
export function resolvePages(data) {
  if (!data?.allSitePage?.nodes) {
    throw Error(
      `Page array from \`query\` wasn't found at \`data.allSitePage.nodes\`.
Fix the custom query or provide a custom \`resolvePages\` function.
https://www.gatsbyjs.com/plugins/gatsby-plugin-sitemap/#api-reference
      `
    )
  }

  return data.allSitePage.nodes
}

/**
 * @name defaultFilterPages
 *
 * 任意のデータを任意の方法で絞り込めるようにする。
 *
 * この関数は allPages.filter((page) => !excludes.some((excludedRoute) => thisFunc(page, ecludedRoute, tools))) の形で実行される
 * allPages は resolvePages の結果である
 *
 * @param {object} page
 * @param {string} excludedRoute - プラグイン設定の `options.exclude` の配列
 * @param {object} tools - 絞り込みに必要なツールを含む
 *
 * @returns {boolean}
 */
export function defaultFilterPages(
  page,
  excludedRoute,
  { minimatch, withoutTrailingSlash, resolvePagePath }
) {
  if (typeof excludedRoute !== `string`) {
    throw new Error(
      `You've passed something other than string to the exclude array. This is supported, but you'll have to write a custom filter function.
Ignoring the input for now: ${JSON.stringify(excludedRoute, null, 2)}
https://www.gatsbyjs.com/plugins/gatsby-plugin-sitemap/#api-reference
      `
    )
  }

  // minimatch は、例がないとどうしても分かりにくい
  // TODO: 例を追加する
  return minimatch(
    withoutTrailingSlash(resolvePagePath(page)),
    withoutTrailingSlash(excludedRoute)
  )
}

/**
 * @name serialize
 *
 * この関数は allPages.map(page => thisFunc(page, siteUrl, tools)) の形で実行される
 * allpages は絞り込み処理の結果である
 *
 * @param {object[]} page - resolvePages 関数の結果
 * @param {object} tools - シリアライズ用のツールを含む
 */
export function serialize(page, { resolvePagePath }) {
  return {
    url: `${resolvePagePath(page)}`,
    changefreq: `daily`,
    priority: 0.7,
  }
}

const defaultExcludes = [
  `/dev-404-page`,
  `/404`,
  `/404.html`,
  `/offline-plugin-app-shell-fallback`,
]

export function pageFilter({ allPages, filterPages, excludes }) {
  const messages = []

  if (
    !Array.isArray(allPages) ||
    typeof filterPages !== `function` ||
    !Array.isArray(excludes)
  ) {
    throw new Error(`Invalid options passed to page Filter function`)
  }

  // TODO: これらのループを最適化すべきである
  const filteredPages = allPages.filter(page => {
    const defaultFilterMatches = defaultExcludes.some(exclude => {
      try {
        const doesMatch = defaultFilterPages(page, exclude, {
          minimatch,
          withoutTrailingSlash,
          resolvePagePath,
        })

        return doesMatch
      } catch {
        throw new Error(`${REPORTER_PREFIX} Error in default page filter`)
      }
    })

    if (defaultFilterMatches) {
      messages.push(
        `${REPORTER_PREFIX} Default filter excluded page ${resolvePagePath(
          page
        )}`
      )
    }

    // ページがデフォルトの設定で除外対象になっている場合は、カスタムの除外設定を確認する必要はない
    if (defaultFilterMatches) {
      return !defaultFilterMatches
    }

    const customFilterMatches = excludes.some(exclude => {
      try {
        return filterPages(page, exclude, {
          minimatch,
          withoutTrailingSlash,
          resolvePagePath,
        })
      } catch {
        throw new Error(
          `${REPORTER_PREFIX} Error in custom page filter.
If you've customized your excludes you may need to provide a custom "filterPages" function in your config.
https://www.gatsbyjs.com/plugins/gatsby-plugin-sitemap/#api-reference
`
        )
      }
    })

    if (customFilterMatches) {
      messages.push(
        `${REPORTER_PREFIX} Custom filtering excluded page ${resolvePagePath(
          page
        )}`
      )
    }

    return !(defaultFilterMatches || customFilterMatches)
  })

  return { filteredPages, messages }
}
