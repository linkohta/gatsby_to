import webpackHotMiddleware from "@gatsbyjs/webpack-hot-middleware"
import webpackDevMiddleware, { type Watching } from "webpack-dev-middleware"
import got, { Method } from "got"
import webpack, { Compilation } from "webpack"
import express from "express"
import compression from "compression"
import { createHandler as createGraphqlEndpointHandler } from "graphql-http/lib/use/express"
import type { OperationContext } from "graphql-http"
import graphiqlExplorer from "gatsby-graphiql-explorer"
import { FragmentDefinitionNode, GraphQLError, Kind } from "graphql"
import { slash, uuid } from "gatsby-core-utils"
import http from "http"
import https from "https"
import cors from "cors"
import launchEditor from "react-dev-utils/launchEditor"
import { codeFrameColumns } from "@babel/code-frame"
import * as fs from "fs-extra"

import { withBasePath } from "../utils/path"
import webpackConfig from "../utils/webpack.config"
import { store, emitter } from "../redux"
import report from "gatsby-cli/lib/reporter"
import * as WorkerPool from "../utils/worker/pool"

import { developStatic } from "../commands/develop-static"
import withResolverContext from "../schema/context"
import { websocketManager, WebsocketManager } from "../utils/websocket-manager"
import {
  reverseFixedPagePath,
  readPageData,
  IPageDataWithQueryResult,
} from "./page-data"
import { getPageData as getPageDataExperimental } from "./get-page-data"
import { findPageByPath } from "./find-page-by-path"
import apiRunnerNode from "../utils/api-runner-node"
import * as path from "path"

import { Stage, IProgram } from "../commands/types"
import { findOriginalSourcePositionAndContent } from "./stack-trace-utils"
import { appendPreloadHeaders } from "./develop-preload-headers"
import {
  routeLoadingIndicatorRequests,
  writeVirtualLoadingIndicatorModule,
} from "./loading-indicator"
import { renderDevHTML } from "./dev-ssr/render-dev-html"
import { getServerData, IServerData } from "./get-server-data"
import { ROUTES_DIRECTORY } from "../constants"
import { getPageMode } from "./page-mode"
import { configureTrailingSlash } from "./express-middlewares"
import type { Express } from "express"
import { addImageRoutes } from "gatsby-plugin-utils/polyfill-remote-file"
import { isFileInsideCompilations } from "./webpack/utils/is-file-inside-compilations"

type ActivityTracker = any // TODO: reporter に型が付いたら、これを適切な型に置き換える

export type WebpackWatching = NonNullable<Watching>

interface IServer {
  compiler: webpack.Compiler
  listener: http.Server | https.Server
  webpackActivity: ActivityTracker
  websocketManager: WebsocketManager
  workerPool: WorkerPool.GatsbyWorkerPool
  webpackWatching: WebpackWatching
}

export async function startServer(
  program: IProgram,
  app: Express,
  workerPool: WorkerPool.GatsbyWorkerPool = WorkerPool.create()
): Promise<IServer> {
  const directory = program.directory
  const PAGE_RENDERER_PATH = path.join(
    program.directory,
    ROUTES_DIRECTORY,
    `render-page.js`
  )

  const webpackActivity = report.activityTimer(`Building development bundle`, {
    id: `webpack-develop`,
  })
  webpackActivity.start()

  // ローディングインジケーター
  // webpack のコンパイルを失敗させないように、仮想モジュールは常に書き出す。ただし、express のルートハンドラーを追加するのは、
  // query on demand が有効で、ローディングインジケーターが無効にされていない場合だけである
  writeVirtualLoadingIndicatorModule()

  // GATSBY_EXPERIMENTAL_DEV_SSR をマージするときに、以下を削除する
  const directoryPath = withBasePath(directory)
  const { buildRenderer, doBuildPages } = require(`../commands/build-html`)
  const createIndexHtml = async (activity: ActivityTracker): Promise<void> => {
    try {
      const { rendererPath, close } = await buildRenderer(
        program,
        Stage.DevelopHTML,
        activity.span
      )
      await doBuildPages(
        rendererPath,
        [`/`],
        activity,
        workerPool,
        Stage.DevelopHTML
      )
      // コンパイラーを閉じる
      await close()
    } catch (err) {
      if (err.name !== `WebpackError`) {
        report.panic(err)
        return
      }
      report.panic(
        report.stripIndent`
          There was an error compiling the html.js component for the development server.
          See our docs page on debugging HTML builds for help https://gatsby.dev/debug-html
        `,
        err
      )
    }
  }
  const indexHTMLActivity = report.phantomActivity(`building index.html`, {})

  let pageRenderer: string
  if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    const { buildRenderer } = require(`../commands/build-html`)
    pageRenderer = (await buildRenderer(program, Stage.DevelopHTML))
      .rendererPath
    const { initDevWorkerPool } = require(`./dev-ssr/render-dev-html`)
    initDevWorkerPool()
  } else {
    indexHTMLActivity.start()

    await createIndexHtml(indexHTMLActivity)

    indexHTMLActivity.end()
  }

  const devConfig = await webpackConfig(
    program,
    directory,
    Stage.Develop,
    program.port,
    {
      parentSpan: webpackActivity.span,
    }
  )

  const compiler = webpack(devConfig)

  /**
   * express の app をセットアップする。
   **/
  app.use(compression())
  app.use(
    webpackHotMiddleware(compiler, {
      log: false,
      path: `/__webpack_hmr`,
      heartbeat: 10 * 1000,
    })
  )

  app.use(cors())

  /**
   * 先頭に 1 つ以上のアンダースコアが付いた、graphql または graphiql のすべてのエンドポイントに一致するパターン
   */
  // express 5 では、パスの文字列の中に正規表現（`/_+graphi?ql`）を書けない。そのため、正規表現で
  // マウントしたルーターの中に、GraphiQL と GraphQL のエンドポイントを置いている
  const graphqlEndpoint = /^\/_+graphi?ql(?=\/|$)/i
  const graphqlRouter = express.Router()
  app.use(graphqlEndpoint, graphqlRouter)

  graphiqlExplorer(graphqlRouter, {
    graphqlEndpoint: `/`,
    getFragments: function getFragments(): Array<FragmentDefinitionNode> {
      const fragments: Array<FragmentDefinitionNode> = []
      for (const def of store.getState().definitions.values()) {
        if (def.def.kind === Kind.FRAGMENT_DEFINITION) {
          fragments.push(def.def)
        }
      }
      return fragments
    },
  })

  graphqlRouter.use(
    createGraphqlEndpointHandler({
      schema() {
        return store.getState().schema
      },
      context() {
        return withResolverContext({
          schema: store.getState().schema,
          schemaComposer: store.getState().schemaCustomization.composer,
          context: {},
          customContext: store.getState().schemaCustomization.context,
        }) as unknown as OperationContext
      },
      onOperation(_req, _args, result) {
        if (result.errors) {
          result.errors = result.errors.map(
            err =>
              ({
                ...err.toJSON(),
                extensions: {
                  stack: err.stack ? err.stack.split(`\n`) : [],
                },
              }) as unknown as GraphQLError
          )
        }

        result.extensions = {
          enableRefresh: process.env.ENABLE_GATSBY_REFRESH_ENDPOINT,
          refreshToken: process.env.GATSBY_REFRESH_TOKEN,
        }

        return result
      },
    })
  )

  /**
   * 外部のデータソースを更新する。
   * この動作はデフォルトでは無効だが、環境変数 ENABLE_GATSBY_REFRESH_ENDPOINT で有効にできる
   * 環境変数 GATSBY_REFRESH_TOKEN がなければ、Authorization ヘッダーは不要である
   **/
  const REFRESH_ENDPOINT = `/__refresh`
  const refresh = async (
    req: express.Request,
    pluginName?: string
  ): Promise<void> => {
    global.__GATSBY.buildId = uuid.v4()

    emitter.emit(`WEBHOOK_RECEIVED`, {
      webhookBody: req.body,
      pluginName,
    })
  }

  app.post(`${REFRESH_ENDPOINT}{/:plugin_name}`, express.json(), (req, res) => {
    const pluginName = req.params[`plugin_name`]

    const enableRefresh = process.env.ENABLE_GATSBY_REFRESH_ENDPOINT
    const refreshToken = process.env.GATSBY_REFRESH_TOKEN
    const authorizedRefresh =
      !refreshToken || req.headers.authorization === refreshToken

    if (enableRefresh && authorizedRefresh) {
      refresh(req, pluginName)
      res.status(200)
      res.setHeader(`content-type`, `application/json`)
    } else {
      res.status(authorizedRefresh ? 404 : 403)
      res.json({
        error: enableRefresh
          ? `Authorization failed. Make sure you add authorization header to your refresh requests`
          : `Refresh endpoint is not enabled. Run gatsby with "ENABLE_GATSBY_REFRESH_ENDPOINT=true" environment variable set.`,
        isEnabled: !!process.env.ENABLE_GATSBY_REFRESH_ENDPOINT,
      })
    }
    res.end()
  })

  app.get(`/__open-stack-frame-in-editor`, (req, res) => {
    if (req.query.fileName) {
      const fileName = path.resolve(process.cwd(), req.query.fileName as string)
      const lineNumber = parseInt(req.query.lineNumber as string, 10)
      launchEditor(fileName, isNaN(lineNumber) ? 1 : lineNumber)
    }
    res.end()
  })

  addImageRoutes(app, store)

  const webpackDevMiddlewareInstance = webpackDevMiddleware(compiler, {
    publicPath: devConfig.output.publicPath,
    stats: `errors-only`,
    serverSideRender: true,
  })

  app.use(webpackDevMiddlewareInstance)

  app.get(
    `/page-data/*pagePath/page-data.json`,
    async (req, res, next): Promise<void> => {
      // express 5 のワイルドカードは、パスを `/` で区切った配列になる
      const requestedPagePath = req.params.pagePath.join(`/`)
      if (!requestedPagePath) {
        next()
        return
      }

      const potentialPagePath = reverseFixedPagePath(requestedPagePath)
      const page = findPageByPath(store.getState(), potentialPagePath, false)

      if (page) {
        try {
          let serverDataPromise: Promise<IServerData> | Promise<Error> =
            Promise.resolve({})
          const pageMode = getPageMode(page)

          if (pageMode === `SSR`) {
            const renderer = require(PAGE_RENDERER_PATH)
            const componentInstance = await renderer.getPageChunk(page)

            serverDataPromise = getServerData(
              req,
              page,
              potentialPagePath,
              componentInstance
            ).catch(error => error)
          }

          let pageData: IPageDataWithQueryResult
          // TODO query-engine へ移す
          if (process.env.GATSBY_QUERY_ON_DEMAND) {
            pageData = await getPageDataExperimental(page.path)
          } else {
            pageData = await readPageData(
              path.join(store.getState().program.directory, `public`),
              page.path
            )
          }

          let statusCode = 200
          if (pageMode === `SSR`) {
            try {
              const result = await serverDataPromise

              if (result instanceof Error) {
                throw result
              }

              if (result.headers) {
                for (const [name, value] of Object.entries(result.headers)) {
                  res.setHeader(name, value)
                }
              }

              if (result.status) {
                statusCode = result.status
              }

              pageData.result.serverData = result.props
              pageData.getServerDataError = null
            } catch (error) {
              const structuredError = report.panicOnBuild({
                id: `95315`,
                context: {
                  sourceMessage: error.message,
                  pagePath: requestedPagePath,
                  potentialPagePath,
                },
                error,
              })
              // websocket で送る代わりに page-data.json ファイルを使う。そのほうが、関係するエラーだけを
              // 表示することと、エラーを消すことが簡単になるためである
              // query-result-store がこれに反応する
              pageData.getServerDataError = structuredError
            }
            pageData.path = page.matchPath ? `/${potentialPagePath}` : page.path
          } else {
            // ユーザーが getServerData 関数を削除しても、Gatsby のブラウザーランタイムにはキャッシュされた page-data が残っている。
            // キャッシュされた serverData を常にリセットするために、`null` を送る:
            pageData.result.serverData = null
          }

          res.status(statusCode).send(pageData)
          return
        } catch (e) {
          report.error(
            `Error loading a result for the page query in "${requestedPagePath}" / "${potentialPagePath}". Query was not run and no cached result was found.`,
            e
          )
        }
      }

      res.status(404).send({
        path: potentialPagePath,
      })
    }
  )

  app.get(`/__original-stack-frame`, (req, res) => {
    const emptyResponse = {
      codeFrame: `No codeFrame could be generated`,
      sourcePosition: null,
      sourceContent: null,
    }

    let sourceContent: string | null
    let sourceLine: number | undefined
    let sourceColumn: number | undefined
    let sourceEndLine: number | undefined
    let sourceEndColumn: number | undefined
    let sourcePosition: { line?: number; column?: number } | null

    if (req.query?.skipSourceMap) {
      if (!req.query?.moduleId) {
        res.json(emptyResponse)
        return
      }

      const absolutePath = path.resolve(
        store.getState().program.directory,
        req.query.moduleId as string
      )

      const compilation: Compilation =
        res.locals?.webpack?.devMiddleware?.stats?.compilation
      if (!compilation) {
        res.json(emptyResponse)
        return
      }

      if (!isFileInsideCompilations(absolutePath, compilation)) {
        res.json(emptyResponse)
        return
      }

      try {
        sourceContent = fs.readFileSync(absolutePath, `utf-8`)
      } catch (e) {
        res.json(emptyResponse)
        return
      }

      if (req.query?.lineNumber) {
        try {
          sourceLine = parseInt(req.query.lineNumber as string, 10)

          if (req.query?.endLineNumber) {
            sourceEndLine = parseInt(req.query.endLineNumber as string, 10)
          }
          if (req.query?.columnNumber) {
            sourceColumn = parseInt(req.query.columnNumber as string, 10)
          }
          if (req.query?.endColumnNumber) {
            sourceEndColumn = parseInt(req.query.endColumnNumber as string, 10)
          }
        } catch {
          // 行と列の取得に失敗したが、それでもコードフレームの表示を試みるべきである
        }
      }
      sourcePosition = {
        line: sourceLine,
        column: sourceColumn,
      }
    } else {
      const compilation = res.locals?.webpack?.devMiddleware?.stats?.compilation
      if (!compilation) {
        res.json(emptyResponse)
        return
      }

      const moduleId = req.query?.moduleId
      const lineNumber = parseInt((req.query?.lineNumber as string) ?? 1, 10)
      const columnNumber = parseInt(
        (req.query?.columnNumber as string) ?? 1,
        10
      )

      let fileModule
      for (const module of compilation.modules) {
        const moduleIdentifier = compilation.chunkGraph.getModuleId(module)
        if (moduleIdentifier === moduleId) {
          fileModule = module
          break
        }
      }

      if (!fileModule) {
        res.json(emptyResponse)
        return
      }

      // 必要なのは、モジュールのソースではなく、バンドルで使われている webpack の内部ファイルである。
      // モジュールのソースには正しい sourceMap がない。
      const webpackSource = compilation?.codeGenerationResults
        ?.get(fileModule)
        ?.sources.get(`javascript`)

      const sourceMap = webpackSource?.map()

      if (!sourceMap) {
        res.json(emptyResponse)
        return
      }

      const position = {
        line: lineNumber,
        column: columnNumber,
      }
      const result = findOriginalSourcePositionAndContent(sourceMap, position)

      sourcePosition = result?.sourcePosition
      sourceLine = sourcePosition?.line
      sourceColumn = sourcePosition?.column
      sourceContent = result?.sourceContent

      if (!sourceContent || !sourceLine) {
        res.json(emptyResponse)
        return
      }
    }

    const codeFrame = codeFrameColumns(
      sourceContent,
      {
        start: {
          line: sourceLine ?? 0,
          column: sourceColumn ?? 0,
        },
        end: sourceEndLine
          ? {
              line: sourceEndLine,
              column: sourceEndColumn,
            }
          : undefined,
      },
      {
        highlightCode: true,
      }
    )
    res.json({
      codeFrame,
      sourcePosition,
      sourceContent,
    })
  })

  app.get(`/__file-code-frame`, async (req, res) => {
    const emptyResponse = {
      codeFrame: `No codeFrame could be generated`,
      sourcePosition: null,
      sourceContent: null,
    }

    const filePath: string | undefined = req.query?.filePath as string
    const lineNumber = parseInt(req.query?.lineNumber as string, 10)
    const columnNumber = parseInt(req.query?.columnNumber as string, 10)

    if (!filePath) {
      res.json(emptyResponse)
      return
    }

    const absolutePath = path.resolve(
      store.getState().program.directory,
      filePath
    )

    const compilation: Compilation =
      res.locals?.webpack?.devMiddleware?.stats?.compilation
    if (!compilation) {
      res.json(emptyResponse)
      return
    }

    if (!isFileInsideCompilations(absolutePath, compilation)) {
      res.json(emptyResponse)
      return
    }

    const sourceContent = await fs.readFile(absolutePath, `utf-8`)

    const codeFrame = codeFrameColumns(
      sourceContent,
      {
        start: {
          line: lineNumber,
          column: columnNumber ?? 0,
        },
      },
      {
        highlightCode: true,
      }
    )
    res.json({
      codeFrame,
    })
  })

  // 高度な用途のために、app へのアクセスを公開する
  const { developMiddleware } = store.getState().config

  if (developMiddleware) {
    developMiddleware(app)
  }

  const { proxy, trailingSlash } = store.getState().config

  app.use(configureTrailingSlash(() => store.getState(), trailingSlash))

  // ディレクトリのインデックス、つまりディレクトリから index.html を配信することを無効にする。
  // 開発中に古い html ファイルを配信してしまう原因になりうるためである。
  //
  // デフォルトでは、開発環境をセットアップする空の index.html を配信する。
  app.use(developStatic(`public`, { index: false }))

  // API のプロキシをセットアップする。
  if (proxy) {
    proxy.forEach(({ prefix, url }) => {
      app.use(`${prefix}/{*splat}`, (req, res) => {
        const proxiedUrl = url + req.originalUrl
        const {
          // コピーしたヘッダーから `host` を取り除く
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          headers: { host, ...headers },
          method,
        } = req
        req
          .pipe(
            got
              .stream(proxiedUrl, {
                headers,
                method: method as Method,
                decompress: false,
              })
              .on(`response`, response =>
                res.writeHead(response.statusCode || 200, response.headers)
              )
              .on(`error`, (err, _, response) => {
                if (response) {
                  res.writeHead(response.statusCode || 400, response.headers)
                } else {
                  const message = `Error when trying to proxy request "${req.originalUrl}" to "${proxiedUrl}"`

                  report.error(message, err)
                  res.sendStatus(500)
                }
              })
          )
          .pipe(res)
      })
    }, cors())
  }

  await apiRunnerNode(`onCreateDevServer`, { app, deferNodeMutation: true })

  // ここまでで hot-update が処理されなかった場合は、404 を送る。
  // これにより、開発サーバーの再起動後に起きる
  // "Unexpected token < in JSON at position 0" の実行時エラーが直り、
  // ブラウザーで自動的にハードリフレッシュが行われる。
  app.use(/.*\.hot-update\.json$/i, (_, res) => {
    res.status(404).end()
  })

  // HTML ページをレンダリングして配信する。
  if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    app.get(`/{*splat}`, async (req, res, next) => {
      const pathObj = findPageByPath(store.getState(), decodeURI(req.path))

      if (!pathObj) {
        return next()
      }

      const allowTimedFallback = !req.headers[`x-gatsby-wait-for-dev-ssr`]

      await appendPreloadHeaders(pathObj.path, res)

      const htmlActivity = report.phantomActivity(`building HTML for path`, {})
      htmlActivity.start()

      try {
        const { html: renderResponse, serverData } = await renderDevHTML({
          path: pathObj.path,
          page: pathObj,
          skipSsr: Object.prototype.hasOwnProperty.call(req.query, `skip-ssr`),
          store,
          allowTimedFallback,
          htmlComponentRendererPath: PAGE_RENDERER_PATH,
          directory: program.directory,
          req,
        })

        if (serverData?.headers) {
          for (const [name, value] of Object.entries(serverData.headers)) {
            res.setHeader(name, value)
          }
        }
        let statusCode = 200
        if (serverData?.status) {
          statusCode = serverData.status
        }
        res.status(statusCode).send(renderResponse)
      } catch (error) {
        // ページがエラーになったが、ページコンポーネントを読み込めなかった。
        // これは、ページが削除された直後、何も再コンパイルされないうちに
        // そのページがリクエストされた場合の競合状態である。
        if (error === `404 page`) {
          return next()
        }

        // renderDevHTML は、これらの情報を持つエラーを投げる
        const lineNumber = error?.line as number
        const columnNumber = error?.column as number
        const filePath = error?.filename as string
        const sourceContent = error?.sourceContent as string

        report.error({
          id: `11614`,
          context: {
            path: pathObj.path,
            filePath: filePath,
            line: lineNumber,
            column: columnNumber,
          },
        })

        const emptyResponse = {
          codeFrame: `No codeFrame could be generated`,
          sourcePosition: null,
          sourceContent: null,
        }

        if (!sourceContent || !lineNumber) {
          res.json(emptyResponse)
          return null
        }

        const codeFrame = codeFrameColumns(
          sourceContent,
          {
            start: {
              line: lineNumber,
              column: columnNumber ?? 0,
            },
          },
          {
            highlightCode: true,
          }
        )

        const message = {
          codeFrame,
          source: filePath,
          line: lineNumber,
          column: columnNumber ?? 0,
          sourceMessage: error?.message,
          stack: error?.stack,
        }

        try {
          // エラーオーバーレイのために、クライアント専用のコンテンツ用のシェルを生成する
          const { html: clientOnlyShell } = await renderDevHTML({
            path: pathObj.path,
            page: pathObj,
            skipSsr: true,
            store,
            error: message,
            htmlComponentRendererPath: PAGE_RENDERER_PATH,
            directory: program.directory,
            req,
            allowTimedFallback,
          })

          res.send(clientOnlyShell)
        } catch (e) {
          report.error({
            id: `11616`,
            context: {
              sourceMessage: e.message,
            },
            filePath: e.filename,
            location: {
              start: {
                line: e.line,
                column: e.column,
              },
            },
          })

          const minimalHTML = `<head><title>Failed to Server Render (SSR)</title></head><body><h1>Failed to Server Render (SSR)</h1><h2>Error message:</h2><p>${e.message}</p><h2>File:</h2><p>${e.filename}:${e.line}:${e.column}</p><h2>Stack:</h2><pre><code>${e.stack}</code></pre></body>`

          res.send(minimalHTML).status(500)
        }
      }

      htmlActivity.end()

      return null
    })
  }

  if (
    process.env.GATSBY_QUERY_ON_DEMAND &&
    process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
  ) {
    routeLoadingIndicatorRequests(app)
  }

  app.use(async (req, res) => {
    // このキャッチオールのブロックでは POST に対応していないので、404 にすべきである
    if (req.method === `POST`) {
      res.status(404).end()
      return
    }

    const fullUrl = req.protocol + `://` + req.get(`host`) + req.originalUrl
    // これは開発では使われない。
    if (fullUrl.endsWith(`app-data.json`)) {
      res.json({ webpackCompilationHash: `123` })
      // ここに来た場合は存在しないファイルなので、404 を返すだけにする。
    } else if (fullUrl.endsWith(`.json`)) {
      res.json({}).status(404)
    } else {
      await appendPreloadHeaders(req.path, res)

      if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
        try {
          const allowTimedFallback = !req.headers[`x-gatsby-wait-for-dev-ssr`]
          const { html: renderResponse } = await renderDevHTML({
            path: `/dev-404-page/`,
            // renderDevHTML に判断を任せる。
            page: undefined,
            store,
            htmlComponentRendererPath: pageRenderer,
            directory: program.directory,
            req,
            allowTimedFallback,
          })
          res.status(404).send(renderResponse)
        } catch (e) {
          report.error({
            id: `11615`,
            context: {
              sourceMessage: e.message,
            },
            filePath: e.filename,
            location: {
              start: {
                line: e.line,
                column: e.column,
              },
            },
          })
          res.send(e).status(500)
        }
      } else {
        const potentialPagePath = reverseFixedPagePath(decodeURI(req.path))
        const page = findPageByPath(store.getState(), potentialPagePath, false)

        // ページが見つからない場合は 404 を送る
        if (!page) {
          res.status(404)
        }

        // express 5 は、パスの途中に `.` で始まるフォルダー（`.cache`）があるだけで配信を拒否する
        res.sendFile(
          directoryPath(`.cache/develop-html/index.html`),
          { dotfiles: `allow` },
          err => {
            if (err) {
              res.status(500).end()
            }
          }
        )
      }
    }
  })

  /**
   * HTTP サーバーと socket.io をセットアップする。
   **/
  const server = program.ssl
    ? new https.Server(program.ssl, app)
    : new http.Server(app)
  const socket = websocketManager.init({ server })
  const listener = server.listen(program.port, program.host)

  if (!process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    const chokidar = require(`chokidar`)
    const { createGlobWatchFilter } = require(`gatsby-core-utils/watch-globs`)
    // html.js が変更されるたびに index.html を再ビルドするウォッチャーを登録する。
    const watchGlobs = [`src/html.js`, `plugins/**/gatsby-ssr.js`].map(path =>
      slash(directoryPath(path))
    )

    // chokidar 4 以降は glob を監視できないので、glob を親フォルダーの監視と絞り込みに置き換える
    const watchFilter = createGlobWatchFilter()

    chokidar
      .watch(watchFilter.add(watchGlobs), { ignored: watchFilter.ignored })
      .on(`change`, async () => {
        await createIndexHtml(indexHTMLActivity)
        // eslint-disable-next-line no-unused-expressions
        socket?.to(`clients`).emit(`reload`)
      })
  }

  return {
    compiler,
    listener,
    webpackActivity,
    websocketManager,
    workerPool,
    webpackWatching: webpackDevMiddlewareInstance.context
      .watching as WebpackWatching,
  }
}
