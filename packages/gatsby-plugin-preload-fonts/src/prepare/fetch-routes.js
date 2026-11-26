const { createContentDigest, isCI } = require(`gatsby-core-utils`)
const { formatRelative } = require(`date-fns`)
// chalk 5 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: chalk } = require(`chalk`)

const { red, blue, bold, dim } = chalk

// 開発サーバーの GraphQL エンドポイントへクエリを 1 回送るだけなので、
// クライアントライブラリを使わずに Node.js 標準の `fetch` で送る。
// HTTP のエラーと GraphQL の `errors` は、どちらも例外として呼び出し元に伝える。
const request = async (endpoint, query) => {
  const response = await fetch(endpoint, {
    method: `POST`,
    headers: {
      "Content-Type": `application/json`,
      Accept: `application/json`,
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    throw new Error(
      `GraphQL request failed with status ${response.status} ${response.statusText}`
    )
  }

  const { data, errors } = await response.json()
  if (errors && errors.length > 0) {
    throw new Error(errors.map(error => error.message).join(`\n`))
  }

  return data
}

module.exports = async ({ logger, endpoint, cache }) => {
  const query = `
    query Routes {
      allSitePage {
        nodes {
          path
        }
      }
    }
  `

  let routes
  try {
    const { allSitePage } = await request(endpoint, query)
    routes = allSitePage.nodes.map(n => n.path)
  } catch (err) {
    logger.fatal(`

${red(`err`)} could not establish a connection with the dev server
    attempted connection to ${endpoint}

    make sure you've run \`gatsby develop\` and set the
    following env variables (if necessary)

      - ${bold(`HOST`)}          ${dim(`(default: localhost)`)}
      - ${bold(`PORT`)}          ${dim(`(default: 8000)`)}
      - ${bold(`LOG_LEVEL`)}     ${dim(`(default: error)`)}
      - ${bold(`GRAPHQL_PATH`)}  ${dim(`(default: /___graphql)`)}

`)
  }

  const routesHash = createContentDigest(routes)
  // 新しいルートをすべて検出することはできないので、最新の状態を保つために、
  // 再クロールするかどうかをユーザーに尋ねる。
  if (cache.hash === routesHash) {
    // CI ではユーザーに尋ねることができないので、ユーザーが no と答えたものとして処理を打ち切る。
    if (isCI()) {
      return []
    }

    const lastRun = formatRelative(new Date(cache.timestamp), new Date())
    const ok = await logger.confirm(`

  ${blue(`note`)} routes have not changed from the last run; if you haven't
       added any new routes or font requirements since then, you
       should be good to go! would you like to crawl them anyways?

         - ${dim(`last run`)} ${bold(lastRun)}
         - ${dim(`route hash`)} ${bold(cache.hash)}

`)
    if (!ok) {
      return []
    }
  }

  return routes
}
