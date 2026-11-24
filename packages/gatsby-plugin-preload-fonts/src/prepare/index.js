#! /usr/bin/env node

import { createContentDigest } from "gatsby-core-utils"

const { URL } = require(`url`)

const puppeteer = require(`puppeteer`)
const ProgressBar = require(`progress`)
// chalk 5 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: chalk } = require(`chalk`)

const { blue, green, bold, dim } = chalk

const createLogger = require(`./logger`)
const fetchRoutes = require(`./fetch-routes`)
const { load, save, cacheFile } = require(`./cache`)
const { ellipses } = require(`./utils`)

const {
  PORT = 8000,
  HOST = `localhost`,
  LOG_LEVEL = `error`,
  GRAPHQL_PATH = `/___graphql`,
} = process.env

const logger = createLogger(LOG_LEVEL)

const devServer = `http://${HOST}:${PORT}`
const endpoint = path => `${devServer}${path}`

export async function main() {
  logger.newline()
  logger.info(`loading cache`)
  const cache = await load()

  logger.info(`requesting route listing`)
  const routes = await fetchRoutes({
    logger,
    cache,
    endpoint: endpoint(GRAPHQL_PATH),
  })

  // ルートが 1 つも見つからなかった場合は何もしない
  // CI で実行している場合や、ユーザーが更新を望まなかった場合は、ルートが空になることがある
  if (!routes.length) {
    return
  }

  const sections = [
    dim(` crawling routes`),
    `:bar`,
    bold(blue(`:percent`)),
    dim(`eta :etas`),
    ``,
  ]
  const bar = new ProgressBar(sections.join(` `), {
    width: 35,
    total: routes.length,
    complete: `█`,
    incomplete: ` `,
  })
  logger.setAdapter((...args) => bar.interrupt(args.join(` `)))

  const browser = await puppeteer.launch({ args: process.argv.slice(2) })
  const page = await browser.newPage()
  page.setCacheEnabled(false)
  page.on(`requestfinished`, req => {
    if (req.url().match(/(socket\.io|commons\.js)/)) return

    logger.info(`load`, req.method(), req.url())

    if (req.method() === `GET` && req.resourceType() === `font`) {
      logger.debug(`match`, req.url())

      const { pathname } = new URL(page.url())

      if (!Object.prototype.hasOwnProperty.call(cache.assets, pathname)) {
        cache.assets[pathname] = Object.create(null)
      }

      const isSelfHosted = req.url().startsWith(devServer)

      const fontUrl = isSelfHosted
        ? req.url().slice(devServer.length)
        : req.url()

      cache.assets[pathname][fontUrl] = true

      bar.interrupt(green(ellipses(` found ${fontUrl}`, 80)))
    }
  })

  for (const route of routes) {
    // 動的に挿入された <link> と <script> のタグが読み込まれるよう、
    // ネットワーク接続が 2 本以下の状態が 500ms 続くまで待つ
    // （開発サーバーはホットモジュールリロードのために接続を
    // 1 本開いたままにするので、有効な接続が必ず 1 本あり、
    // networkidle0 は待てない）
    //
    // 残念ながら、これによりルートごとの最小の読み込み時間が
    // 約 500ms に増え、大きなサイトではすぐに積み上がる。ここには
    // 最適化の余地があるかもしれない
    logger.info(`visit`, route)
    await page.goto(endpoint(route), { waitUntil: `networkidle2` })
    bar.tick()
  }

  await browser.close()
  logger.resetAdapter()

  cache.hash = createContentDigest(routes)
  cache.timestamp = Date.now()
  await save(cache)

  logger.print(`

  ${green(`ok!`)} a mapping between your application's routes and
      font requirements has been generated; make sure to
      add ${bold(`\`gatsby-plugin-preload-fonts\``)} to your app config

        - ${dim(`output`)} ${bold(cacheFile)}

`)
}

if (process.env.NODE_ENV !== `test`) main()
