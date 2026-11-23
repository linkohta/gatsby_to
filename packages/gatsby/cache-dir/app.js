// Fast Refresh に必要
import "@gatsbyjs/webpack-hot-middleware/client"

import React from "react"
import ReactDOM from "react-dom"

import socketIo from "./socketIo"
import emitter from "./emitter"
import { apiRunner, apiRunnerAsync } from "./api-runner-browser"
import { setLoader, publicLoader } from "./loader"
import { Indicator } from "./loading-indicator/indicator"
import DevLoader from "./dev-loader"
import asyncRequires from "$virtual/async-requires"
// ブートストラップ中に生成される
import matchPaths from "$virtual/match-paths.json"
import { LoadingIndicatorEventHandler } from "./loading-indicator"
import Root from "./root"
import { init as navigationInit } from "./navigation"
// develop では、最低でも何らかの .css が（空であっても）存在するようにする。
// サイトが通常の CSS を一切含まない場合（css-in-js を使っている場合など）に、content-type の不一致の警告が出ないようにするためである
// また、develop 中にすべての CSS が削除されたときに、古い内容の commons.css が残らないようにする
import "./blank.css"

// 仮想の sync-requires、gatsby-browser、navigation で Fast Refresh を有効にする。
// これより下に Fast Refresh の制約を満たさないものがあっても、
// <Root /> コンポーネントをホットリロードできるようにするためである
module.hot.accept(
  [`$virtual/async-requires`, `./api-runner-browser`, `./navigation`],
  () => {
    // asyncRequires はここで自動的に更新されるはずだが（ESM の import と webpack の HMR の仕様による）、
    // loader はそれを知らないので、手動で知らせる必要がある
    loader.updateAsyncRequires(asyncRequires)
  }
)

// エラーオーバーレイのために、Gatsby のイベントシステムを早い段階で初期化する
window._gatsbyEvents = window._gatsbyEvents || []

window.___emitter = emitter

const loader = new DevLoader(asyncRequires, matchPaths)
setLoader(loader)
loader.setApiRunner(apiRunner)

window.___loader = publicLoader

// 開発用エラーオーバーレイのための React 19 のエラーハンドラー
const handleUncaughtError = (error, errorInfo) => {
  console.error(`Uncaught error:`, error, errorInfo)
  window._gatsbyEvents.push([
    `FAST_REFRESH`,
    {
      action: `SHOW_RUNTIME_ERRORS`,
      payload: [error], // 実際の Error オブジェクトを渡す
    },
  ])
  apiRunner(`onUncaughtError`, { error, errorInfo })
}

const handleCaughtError = (error, errorInfo) => {
  // 捕捉されたエラーもオーバーレイのシステムへ転送する
  window._gatsbyEvents.push([
    `FAST_REFRESH`,
    {
      action: `SHOW_RUNTIME_ERRORS`,
      payload: [error],
    },
  ])
  apiRunner(`onCaughtError`, { error, errorInfo })
}

const reactDomClient = require(`react-dom/client`)
const reactFirstRenderOrHydrate = (Component, el) => {
  // マウント先の要素に中身がある場合は hydrate を使う
  const useHydrate = el && el.children.length

  // React 19 以降向けにエラーハンドラーのオプションを渡す（React 18 はこれらのオプションを無視する）
  const errorHandlerOptions = {
    onUncaughtError: handleUncaughtError,
    onCaughtError: handleCaughtError,
  }

  if (useHydrate) {
    const root = reactDomClient.hydrateRoot(el, Component, errorHandlerOptions)
    return () => root.unmount()
  } else {
    const root = reactDomClient.createRoot(el, errorHandlerOptions)
    root.render(Component)
    return () => root.unmount()
  }
}

// jsonp の __webpack_require__.e が commons.js バンドルに追加されるように、
// ダミーの動的 import を行う。これにより、誰かが初めて動的 import を
// 追加したときにホットリロードが壊れなくなる。
//
// これがないと、ランタイムが次のエラーで壊れる。
// "TypeError: __webpack_require__.e is not a function"
export function notCalledFunction() {
  return import(`./dummy`)
}

// サイトやプラグインが、ごく早い段階でコードを実行できるようにする。
apiRunnerAsync(`onClientEntry`).then(() => {
  // クライアントをサーバーの socket.io に接続する
  const socket = socketIo()
  if (socket) {
    socket.on(`reload`, () => {
      window.location.reload()
    })
  }

  /**
   * Service Worker は性質上、永続的である。削除しない限り残り続け、
   * キャッシュされたバージョンのサイトを配信する。
   * ローカルマシンで本番ビルドをテストする必要があるときには、
   * これが特に厄介になる。
   *
   * 開発中に Service Worker を見つけたら警告する。
   */
  if (`serviceWorker` in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      if (registrations.length > 0)
        console.warn(
          `Warning: found one or more service workers present.`,
          `If your site isn't behaving as expected, you might want to remove these.`,
          registrations
        )
    })
  }

  const rootElement = document.getElementById(`___gatsby`)
  const renderer = apiRunner(
    `replaceHydrateFunction`,
    undefined,
    reactFirstRenderOrHydrate
  )[0]

  let dismissLoadingIndicator
  if (
    process.env.GATSBY_QUERY_ON_DEMAND &&
    process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
  ) {
    let indicatorMountElement
    let cleanupFn

    const showIndicatorTimeout = setTimeout(() => {
      indicatorMountElement = document.createElement(
        `first-render-loading-indicator`
      )
      document.body.append(indicatorMountElement)
      cleanupFn = renderer(<Indicator />, indicatorMountElement)
    }, 1000)

    dismissLoadingIndicator = () => {
      clearTimeout(showIndicatorTimeout)
      if (indicatorMountElement) {
        // ユーザーが replaceHydrateFunction を自分で定義している場合、cleanupFn が返されないことがある
        // そのため、利用可能であれば unmountComponentAtNode にフォールバックする
        if (cleanupFn && typeof cleanupFn === `function`) {
          cleanupFn()
        } else {
          // React 18 以前のための後方互換。関数があるかを確かめてから呼んでいるので、非推奨の警告は無視する
          // eslint-disable-next-line react/no-deprecated
          if (typeof ReactDOM.unmountComponentAtNode === `function`) {
            // eslint-disable-next-line react/no-deprecated
            ReactDOM.unmountComponentAtNode(indicatorMountElement)
          } else {
            // これは React 19 で削除された:
            // https://react.dev/blog/2024/04/25/react-19-upgrade-guide#removed-unmountcomponentatnode.
            console.warn(
              `You provided a custom replaceHydrateFunction that does not return a cleanup function.`
            )
          }
        }
        indicatorMountElement.remove()
      }
    }
  }

  Promise.all([
    loader.loadPage(`/dev-404-page/`),
    loader.loadPage(`/404.html`),
    loader.loadPage(window.location.pathname + window.location.search),
  ]).then(() => {
    navigationInit()

    function onHydrated() {
      apiRunner(`onInitialClientRender`)

      // クエリのオンデマンド実行用のオーバーレイをレンダリングする
      if (
        process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR &&
        process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
      ) {
        const indicatorMountElement = document.createElement(`div`)
        indicatorMountElement.setAttribute(
          `id`,
          `query-on-demand-indicator-element`
        )
        document.body.append(indicatorMountElement)

        renderer(<LoadingIndicatorEventHandler />, indicatorMountElement)
      }
    }

    function App() {
      const onClientEntryRanRef = React.useRef(false)

      React.useEffect(() => {
        if (!onClientEntryRanRef.current) {
          onClientEntryRanRef.current = true

          onHydrated()
        }
      }, [])

      return <Root />
    }

    function runRender() {
      if (dismissLoadingIndicator) {
        dismissLoadingIndicator()
      }

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
  })
})
