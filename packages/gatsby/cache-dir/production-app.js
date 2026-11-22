import { apiRunner, apiRunnerAsync } from "./api-runner-browser"
import React from "react"
import { Router, navigate, Location, BaseContext } from "@gatsbyjs/reach-router"
import { ScrollContext } from "gatsby-react-router-scroll"
import { StaticQueryContext } from "./static-query"
import {
  SlicesMapContext,
  SlicesContext,
  SlicesResultsContext,
} from "./slice/context"
import {
  shouldUpdateScroll,
  init as navigationInit,
  RouteUpdates,
} from "./navigation"
import emitter from "./emitter"
import PageRenderer from "./page-renderer"
import asyncRequires from "$virtual/async-requires"
import {
  setLoader,
  ProdLoader,
  publicLoader,
  PageResourceStatus,
  getStaticQueryResults,
  getSliceResults,
} from "./loader"
import EnsureResources from "./ensure-resources"
import stripPrefix from "./strip-prefix"

// ブートストラップ中に生成される
import matchPaths from "$virtual/match-paths.json"
import { reactDOMUtils } from "./react-dom-utils"

const loader = new ProdLoader(asyncRequires, matchPaths, window.pageData)
setLoader(loader)
loader.setApiRunner(apiRunner)

const { render, hydrate } = reactDOMUtils()

window.asyncRequires = asyncRequires
window.___emitter = emitter
window.___loader = publicLoader

navigationInit()

const reloadStorageKey = `gatsby-reload-compilation-hash-match`

apiRunnerAsync(`onClientEntry`).then(() => {
  const handleUncaughtError = (error, errorInfo) => {
    console.error(`Uncaught error:`, error, errorInfo)
    apiRunner(`onUncaughtError`, { error, errorInfo })
  }

  const handleCaughtError = (error, errorInfo) => {
    apiRunner(`onCaughtError`, { error, errorInfo })
  }

  // プラグインが Service Worker を登録できるようにする。プラグインは
  // true を返すだけでよい。
  if (apiRunner(`registerServiceWorker`).filter(Boolean).length > 0) {
    require(`./register-service-worker`)
  }

  // gatsby v2 では、matchPath を使うページで Router を使う場合、
  // パスに完全なパスを含める必要がある。
  // 例:
  //   - ページの matchPath が `/app/*` である
  //   - テンプレート内では、ユーザーはパスとして `/app/xyz` を使う必要がある
  // 破壊的変更を持ち込まないよう、`basepath`/`baseuri` をリセットして
  // 現在の挙動を維持する。
  // v3 で削除する
  const RouteHandler = props => (
    <BaseContext.Provider
      value={{
        baseuri: `/`,
        basepath: `/`,
      }}
    >
      <PageRenderer {...props} />
    </BaseContext.Provider>
  )

  const DataContext = React.createContext({})

  const slicesContext = {
    renderEnvironment: `browser`,
  }

  class GatsbyRoot extends React.Component {
    render() {
      const { children } = this.props
      return (
        <Location>
          {({ location }) => (
            <EnsureResources location={location}>
              {({ pageResources, location }) => {
                const staticQueryResults = getStaticQueryResults()
                const sliceResults = getSliceResults()

                return (
                  <StaticQueryContext.Provider value={staticQueryResults}>
                    <SlicesContext.Provider value={slicesContext}>
                      <SlicesResultsContext.Provider value={sliceResults}>
                        <SlicesMapContext.Provider
                          value={pageResources.page.slicesMap}
                        >
                          <DataContext.Provider
                            value={{ pageResources, location }}
                          >
                            {children}
                          </DataContext.Provider>
                        </SlicesMapContext.Provider>
                      </SlicesResultsContext.Provider>
                    </SlicesContext.Provider>
                  </StaticQueryContext.Provider>
                )
              }}
            </EnsureResources>
          )}
        </Location>
      )
    }
  }

  class LocationHandler extends React.Component {
    render() {
      return (
        <DataContext.Consumer>
          {({ pageResources, location }) => (
            <RouteUpdates location={location}>
              <ScrollContext
                location={location}
                shouldUpdateScroll={shouldUpdateScroll}
              >
                <Router
                  basepath={__BASE_PATH__}
                  location={location}
                  id="gatsby-focus-wrapper"
                >
                  <RouteHandler
                    path={
                      pageResources.page.path === `/404.html` ||
                      pageResources.page.path === `/500.html`
                        ? stripPrefix(location.pathname, __BASE_PATH__)
                        : encodeURI(
                            (
                              pageResources.page.matchPath ||
                              pageResources.page.path
                            ).split(`?`)[0]
                          )
                    }
                    {...this.props}
                    location={location}
                    pageResources={pageResources}
                    {...pageResources.json}
                  />
                </Router>
              </ScrollContext>
            </RouteUpdates>
          )}
        </DataContext.Consumer>
      )
    }
  }

  const { pagePath, location: browserLoc } = window

  // 正規のパス（window.pagePath）がブラウザーのパス（window.location.pathname）と
  // 異なる場合は、明示的に navigate を呼ぶ。SSR のページパスには
  // 検索パラメーターが含まれることがあるが、SSG と DSG では含まれない。
  // ページパスに検索パラメーターが含まれる場合は、クエリパラメーターも比較する。
  // ただし、次の条件がどれも当てはまらない場合に限る:
  //
  // - URL がクライアントサイドのルート（page.matchPath）に一致する
  // - 404 ページである
  // - offline プラグインのシェル（/offline-plugin-app-shell-fallback/）である
  if (
    pagePath &&
    __BASE_PATH__ + pagePath !==
      browserLoc.pathname + (pagePath.includes(`?`) ? browserLoc.search : ``) &&
    !(
      loader.findMatchPath(stripPrefix(browserLoc.pathname, __BASE_PATH__)) ||
      pagePath.match(/^\/(404|500)(\/?|.html)$/) ||
      pagePath.match(/^\/offline-plugin-app-shell-fallback\/?$/)
    )
  ) {
    navigate(
      __BASE_PATH__ +
        pagePath +
        (!pagePath.includes(`?`) ? browserLoc.search : ``) +
        browserLoc.hash,
      {
        replace: true,
      }
    )
  }

  // アクセスが許可されていない場合、sessionStorage が例外を投げることがある。https://github.com/gatsbyjs/gatsby/issues/34512 を参照
  const getSessionStorage = () => {
    try {
      return sessionStorage
    } catch {
      return null
    }
  }

  publicLoader.loadPage(browserLoc.pathname + browserLoc.search).then(page => {
    const sessionStorage = getSessionStorage()

    if (
      page?.page?.webpackCompilationHash &&
      page.page.webpackCompilationHash !== window.___webpackCompilationHash
    ) {
      // plugin-offline のキャッシュを消去する
      if (
        `serviceWorker` in navigator &&
        navigator.serviceWorker.controller !== null &&
        navigator.serviceWorker.controller.state === `activated`
      ) {
        navigator.serviceWorker.controller.postMessage({
          gatsbyApi: `clearPathResources`,
        })
      }

      // html と js（インライン化された `window.___webpackCompilationHash`）が、
      // データ（`app-data.json` ファイル由来）と一致していない。これは、静的クエリの
      // 読み込みエラーなどの問題を引き起こすことがある（静的クエリの一覧は `page-data` の中にあり、
      // 現在読み込まれている `.js` スクリプトと一致しない可能性があるため）。
      // ハッシュが一致しない場合はリロードを試みるが、リロードしても直らない場合
      // （デプロイが壊れている可能性がある）にも対処し、無限にリロードし続けないようにする
      if (sessionStorage) {
        const isReloaded = sessionStorage.getItem(reloadStorageKey) === `1`

        if (!isReloaded) {
          sessionStorage.setItem(reloadStorageKey, `1`)
          window.location.reload(true)
          return
        }
      }
    }

    if (sessionStorage) {
      sessionStorage.removeItem(reloadStorageKey)
    }

    if (!page || page.status === PageResourceStatus.Error) {
      const message = `page resources for ${browserLoc.pathname} not found. Not rendering React`

      // チャンクがエラーを投げた場合は、本当のエラーを捕捉したい
      // これは https://github.com/gatsbyjs/gatsby/issues/19618 の助けになるはずである
      if (page && page.error) {
        console.error(message)
        throw page.error
      }

      throw new Error(message)
    }

    const SiteRoot = apiRunner(
      `wrapRootElement`,
      { element: <LocationHandler /> },
      <LocationHandler />,
      ({ result }) => {
        return { element: result }
      }
    ).pop()

    const App = function App() {
      const onClientEntryRanRef = React.useRef(false)

      React.useEffect(() => {
        if (!onClientEntryRanRef.current) {
          onClientEntryRanRef.current = true
          if (performance.mark) {
            performance.mark(`onInitialClientRender`)
          }

          apiRunner(`onInitialClientRender`)
        }
      }, [])

      return <GatsbyRoot>{SiteRoot}</GatsbyRoot>
    }

    const focusEl = document.getElementById(`gatsby-focus-wrapper`)

    // クライアント専用のページは body が空なので、React がハイドレーションの
    // 不一致を訴えないよう、通常のレンダリングを行う。
    let defaultRenderer = (Component, el) =>
      render(Component, el, {
        onUncaughtError: handleUncaughtError,
        onCaughtError: handleCaughtError,
      })

    if (focusEl && focusEl.children.length) {
      defaultRenderer = (Component, el) =>
        hydrate(Component, el, {
          onUncaughtError: handleUncaughtError,
          onCaughtError: handleCaughtError,
        })
    }

    const renderer =
      apiRunner(`replaceHydrateFunction`, undefined, defaultRenderer)[0] ||
      defaultRenderer

    function runRender() {
      const rootElement =
        typeof window !== `undefined`
          ? document.getElementById(`___gatsby`)
          : null

      renderer(<App />, rootElement)
    }

    // https://github.com/madrobby/zepto/blob/b5ed8d607f67724788ec9ff492be297f64d47dfc/src/zepto.js#L439-L450
    // TODO IE 10 のサポートを削除する
    const doc = document
    if (
      doc.readyState === `complete` ||
      (doc.readyState !== `loading` && !doc.documentElement.doScroll)
    ) {
      setTimeout(function () {
        runRender()
      }, 0)
    } else {
      const handler = function () {
        doc.removeEventListener(`DOMContentLoaded`, handler, false)
        window.removeEventListener(`load`, handler, false)

        runRender()
      }

      doc.addEventListener(`DOMContentLoaded`, handler, false)
      window.addEventListener(`load`, handler, false)
    }

    return
  })
})
