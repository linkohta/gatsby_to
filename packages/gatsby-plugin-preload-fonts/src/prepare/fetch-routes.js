const { createContentDigest, isCI } = require(`gatsby-core-utils`)
const { request } = require(`graphql-request`)
const { formatRelative } = require(`date-fns`)
// chalk 5 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: chalk } = require(`chalk`)

const { red, blue, bold, dim } = chalk

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
