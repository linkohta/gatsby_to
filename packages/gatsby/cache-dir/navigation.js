import React from "react"
import PropTypes from "prop-types"
import loader, { PageResourceStatus } from "./loader"
import { maybeGetBrowserRedirect } from "./redirect-utils.js"
import { apiRunner } from "./api-runner-browser"
import emitter from "./emitter"
import { RouteAnnouncerProps } from "./route-announcer-props"
import {
  navigate as reachNavigate,
  globalHistory,
} from "@gatsbyjs/reach-router"
import { parsePath } from "gatsby-link"

function maybeRedirect(pathname) {
  const redirect = maybeGetBrowserRedirect(pathname)
  const { hash, search } = window.location

  if (redirect != null) {
    window.___replace(redirect.toPath + search + hash)
    return true
  } else {
    return false
  }
}

// 処理されなかったチャンク読み込みエラーを捕捉し、アプリを強制的に再起動する。
let nextRoute = ``

window.addEventListener(`unhandledrejection`, event => {
  if (/loading chunk \d* failed./i.test(event.reason)) {
    if (nextRoute) {
      window.location.pathname = nextRoute
    }
  }
})

const onPreRouteUpdate = (location, prevLocation) => {
  if (!maybeRedirect(location.pathname)) {
    nextRoute = location.pathname
    apiRunner(`onPreRouteUpdate`, { location, prevLocation })
  }
}

const onRouteUpdate = (location, prevLocation) => {
  if (!maybeRedirect(location.pathname)) {
    apiRunner(`onRouteUpdate`, { location, prevLocation })
    if (
      process.env.GATSBY_QUERY_ON_DEMAND &&
      process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
    ) {
      emitter.emit(`onRouteUpdate`, { location, prevLocation })
    }
  }
}

const navigate = (to, options = {}) => {
  // 数値による前後へのナビゲーションに対応する
  // navigate(-2)（履歴を 2 つ戻る）
  // navigate(2)（履歴を 2 つ進む）
  if (typeof to === `number`) {
    globalHistory.navigate(to)
    return
  }

  const { pathname, search, hash } = parsePath(to)
  const redirect = maybeGetBrowserRedirect(pathname)

  // リダイレクトする場合は、渡された pathname を
  // リダイレクト先のものに置き換えるだけでよい。
  if (redirect) {
    to = redirect.toPath + search + hash
  }

  // Service Worker の更新があった場合は、パスに関係なくウィンドウをリロードし、
  // pathname のホワイトリストをリセットする
  if (window.___swUpdated) {
    window.location = pathname + search + hash
    return
  }

  // リソースがまだ揃っていない場合に備え、遷移してローダーを表示するまで
  // 1 秒待つタイマーを開始する。
  const timeoutId = setTimeout(() => {
    emitter.emit(`onDelayedLoadPageResources`, { pathname })
    apiRunner(`onRouteUpdateDelayed`, {
      location: window.location,
    })
  }, 1000)

  loader.loadPage(pathname + search).then(pageResources => {
    // ページリソースがない場合は、ページを再読み込みする
    // 単に `window.location.reload()` とせずにこうするのは、戻るボタンと
    // 進むボタンが動作するようにするためである。そうしないと、戻るを
    // 押したときにブラウザーは URL だけを変更し、JS が変更を処理することを
    // 期待する。しかし、そこは Gatsby のページではないかもしれないので、
    // 常にうまくいくとは限らない。
    if (!pageResources || pageResources.status === PageResourceStatus.Error) {
      window.history.replaceState({}, ``, location.href)
      window.location = pathname
      clearTimeout(timeoutId)
      return
    }

    // 読み込んだページのコンパイルハッシュが window のものと異なる場合、
    // サーバーで再ビルドが行われている。リロードする。
    if (process.env.NODE_ENV === `production` && pageResources) {
      if (
        pageResources.page.webpackCompilationHash !==
        window.___webpackCompilationHash
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

        window.location = pathname + search + hash
      }
    }
    reachNavigate(to, options)
    clearTimeout(timeoutId)
  })
}

function shouldUpdateScroll(prevRouterProps, { location }) {
  const { pathname, hash } = location
  const results = apiRunner(`shouldUpdateScroll`, {
    prevRouterProps,
    // `pathname` は後方互換性のため
    pathname,
    routerProps: { location },
    getSavedScrollPosition: args => [
      0,
      // FIXME これは実のところ大きなコードスメルなので、修正すべきである
      // eslint-disable-next-line @babel/no-invalid-this
      this._stateStorage.read(args, args.key),
    ],
  })
  if (results.length > 0) {
    // 最後に登録された shouldUpdateScroll の結果を使う。これにより、ユーザーがプラグインの設定を上書きできる
    // @see https://github.com/gatsbyjs/gatsby/issues/12038
    return results[results.length - 1]
  }

  if (prevRouterProps) {
    const {
      location: { pathname: oldPathname },
    } = prevRouterProps
    if (oldPathname === pathname) {
      // 要素が存在する場合はそこへスクロールする。存在しない場合、またはハッシュが
      // 指定されていない場合は、先頭へスクロールする。
      return hash ? decodeURI(hash.slice(1)) : [0, 0]
    }
  }
  return true
}

function init() {
  // "scroll-behavior" パッケージは location オブジェクトに "action" があることを
  // 期待するので、コピーしておく。
  globalHistory.listen(args => {
    args.location.action = args.action
  })

  window.___push = to => navigate(to, { replace: false })
  window.___replace = to => navigate(to, { replace: true })
  window.___navigate = (to, options) => navigate(to, options)
}

class RouteAnnouncer extends React.Component {
  constructor(props) {
    super(props)
    this.announcementRef = React.createRef()
  }

  componentDidUpdate(prevProps, nextProps) {
    requestAnimationFrame(() => {
      let pageName = `new page at ${this.props.location.pathname}`
      if (document.title) {
        pageName = document.title
      }
      const pageHeadings = document.querySelectorAll(`#gatsby-focus-wrapper h1`)
      if (pageHeadings && pageHeadings.length) {
        pageName = pageHeadings[0].textContent
      }
      const newAnnouncement = `Navigated to ${pageName}`
      if (this.announcementRef.current) {
        const oldAnnouncement = this.announcementRef.current.innerText
        if (oldAnnouncement !== newAnnouncement) {
          this.announcementRef.current.innerText = newAnnouncement
        }
      }
    })
  }

  render() {
    return <div {...RouteAnnouncerProps} ref={this.announcementRef}></div>
  }
}

const compareLocationProps = (prevLocation, nextLocation) => {
  if (prevLocation.href !== nextLocation.href) {
    return true
  }

  if (prevLocation?.state?.key !== nextLocation?.state?.key) {
    return true
  }

  return false
}

// on(Pre)RouteUpdate API を実行する
class RouteUpdates extends React.Component {
  constructor(props) {
    super(props)
    onPreRouteUpdate(props.location, null)
  }

  componentDidMount() {
    onRouteUpdate(this.props.location, null)
  }

  shouldComponentUpdate(nextProps) {
    if (compareLocationProps(this.props.location, nextProps.location)) {
      onPreRouteUpdate(nextProps.location, this.props.location)
      return true
    }
    return false
  }

  componentDidUpdate(prevProps) {
    if (compareLocationProps(prevProps.location, this.props.location)) {
      onRouteUpdate(this.props.location, prevProps.location)
    }
  }

  render() {
    return (
      <React.Fragment>
        {this.props.children}
        <RouteAnnouncer location={location} />
      </React.Fragment>
    )
  }
}

RouteUpdates.propTypes = {
  location: PropTypes.object.isRequired,
}

export { init, shouldUpdateScroll, RouteUpdates, maybeGetBrowserRedirect }
