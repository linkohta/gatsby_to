/**
 * この引数は空である。`pluginOptions` が常に第 2 引数になるように、一貫性のために置いている。
 * @typedef {undefined} emptyArg
 */

/**
 * `gatsby-config.js` で定義されたオプションを含むオブジェクト
 * @typedef {object} pluginOptions
 */

/**
 * Gatsby のブラウザーランタイムが最初に起動したときに呼ばれる。
 * @param {emptyArg} _
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onClientEntry = () => {
 *   console.log("We've started!")
 *   callAnalyticsAPI()
 * }
 */
export const onClientEntry = true

/**
 * クライアントで Gatsby App の最初の（2 回目以降ではない）レンダリングが終わったときに呼ばれる。
 * @param {emptyArg} _
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onInitialClientRender = () => {
 *   console.log("ReactDOM.render has executed")
 * }
 */
export const onInitialClientRender = true

/**
 * location の変更が始まったときに呼ばれる。
 * @param {object} $0
 * @param {object} $0.location location オブジェクト
 * @param {object|null} $0.prevLocation 直前の location オブジェクト
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onPreRouteUpdate = ({ location, prevLocation }) => {
 *   console.log("Gatsby started to change location to", location.pathname)
 *   console.log("Gatsby started to change location from", prevLocation ? prevLocation.pathname : null)
 * }
 */
export const onPreRouteUpdate = true

/**
 * location の変更に 1 秒より長くかかっているときに呼ばれる。
 * @param {object} $0
 * @param {object} $0.location location オブジェクト
 * @param {object} $0.action ルートの変更を引き起こした "action"
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onRouteUpdateDelayed = () => {
 *   console.log("We can show loading indicator now")
 * }
 */
export const onRouteUpdateDelayed = true

/**
 * ユーザーがルートを変更したときに呼ばれる。アプリの最初の読み込み時も含む
 * @param {object} $0
 * @param {object} $0.location location オブジェクト
 * @param {object|null} $0.prevLocation 直前の location オブジェクト
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onRouteUpdate = ({ location, prevLocation }) => {
 *   console.log('new pathname', location.pathname)
 *   console.log('old pathname', prevLocation ? prevLocation.pathname : null)
 * }
 */
export const onRouteUpdate = true

/**
 * プラグインが、ナビゲーション時のスクロールの動作を変えられるようにする。
 * デフォルトの動作は、最後のスクロール位置を保持し、ナビゲーション時にその位置までスクロールして戻すことである。
 * プラグインはこれを上書きして、スクロール先の座標の配列または要素の名前を返すこともできる。
 * @param {object} $0
 * @param {object} $0.prevRouterProps ルートが変わる前の、ルーターの直前の状態。
 * @param {object} $0.routerProps ルーターの現在の状態。
 * @param {string} $0.pathname 新しい pathname（v1 との後方互換性のため）。
 * @param {function} $0.getSavedScrollPosition location を受け取り、その location の
 * 最後のスクロール位置の座標を返す。スクロールが行われていなければ `null` を
 * 返す。Gatsby はルートごとのスクロール位置を `SessionStorage` に
 * 保存するので、ページの再読み込み後も利用できる。
 * @returns {(boolean|string|Array)} スクロール先の座標の [x, y] 配列、
 * スクロール先の要素の `id` または `name` の文字列、
 * スクロール位置を更新しない場合の `false`、デフォルトの動作にする場合の `true` の
 * いずれかを返すこと。
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.shouldUpdateScroll = ({
 *   routerProps: { location },
 *   getSavedScrollPosition
 * }) => {
 *   const currentPosition = getSavedScrollPosition(location)
 *   const queriedPosition = getSavedScrollPosition({ pathname: `/random` })
 *
 *   window.scrollTo(...(currentPosition || [0, 0]))
 *
 *   return false
 * }
 */
export const shouldUpdateScroll = true

/**
 * プラグインが Service Worker を登録できるようにする。true を返す関数にすること。
 * @param {emptyArg} _
 * @param {pluginOptions} pluginOptions
 * @returns {boolean} Gatsby が `/sw.js` の Service Worker を登録すべきか
 * @example
 * exports.registerServiceWorker = () => true
 */
export const registerServiceWorker = true

/**
 * それぞれのページ要素をラップするために使える。
 *
 * ページが切り替わってもアンマウントされないラッパーコンポーネントを、ページの外側に
 * 設定するのに役立つ。コンテキストプロバイダーを設定するには、[wrapRootElement](#wrapRootElement) を使う。
 *
 * _注:_
 * Gatsby の [SSR API](/docs/ssr-apis/#wrapPageElement) に同等のフックがある。
 * 両方の API を一緒に使うことを推奨する。
 * 使用例については、[Using i18n](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-i18n) を参照。
 * @param {object} $0
 * @param {ReactNode} $0.element Gatsby が作成した "Page" の React 要素。
 * @param {object} $0.props ページが使う props オブジェクト。
 * @param {pluginOptions} pluginOptions
 * @returns {ReactNode} ラップした要素
 * @example
 * const React = require("react")
 * const Layout = require("./src/components/layout").default
 *
 * exports.wrapPageElement = ({ element, props }) => {
 *   // props provide same data to Layout as Page element will get
 *   // including location, data, etc - you don't need to pass it
 *   return <Layout {...props}>{element}</Layout>
 * }
 */
export const wrapPageElement = true

/**
 * ルート要素をラップするために使える。
 *
 * アプリケーションをラップするコンテキストプロバイダーを設定するのに役立つ。
 * ページの外側に常に表示する UI 要素を設定するには、[wrapPageElement](#wrapPageElement) を使う。
 *
 * _注:_
 * Gatsby の [SSR API](/docs/ssr-apis/#wrapRootElement) に同等のフックがある。
 * 両方の API を一緒に使うことを推奨する。
 * 使用例については、[Using redux](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-redux) を参照。
 * @param {object} $0
 * @param {ReactNode} $0.element Gatsby が作成した "Root" の React 要素。
 * @param {pluginOptions} pluginOptions
 * @returns {ReactNode} ラップした要素
 * @example
 * const React = require("react")
 * const { Provider } = require("react-redux")
 *
 * const createStore = require("./src/state/createStore")
 * const store = createStore()
 *
 * exports.wrapRootElement = ({ element }) => {
 *   return (
 *     <Provider store={store}>
 *       {element}
 *     </Provider>
 *   )
 * }
 */
export const wrapRootElement = true

/**
 * ある pathname のプリフェッチが開始されたときに呼ばれる。独自の
 * プリフェッチのロジックを持つプラグインのためのものである。
 * @param {object} $0
 * @param {string} $0.pathname これからリソースをプリフェッチする pathname
 * @param {function} $0.loadPage pathname に関連するリソースを取得する関数
 * @param {pluginOptions} pluginOptions
 */
export const onPrefetchPathname = true

/**
 * ある pathname のプリフェッチが成功したときに呼ばれる。独自の
 * プリフェッチのロジックを持つプラグインのためのものである。
 * @param {object} $0
 * @param {string} $0.pathname リソースのプリフェッチが完了した pathname
 * @param {pluginOptions} pluginOptions
 */
export const onPostPrefetchPathname = true

/**
 * プラグインは、プリフェッチのロジックを引き受けることができる。その場合は、これを呼んで、
 * 重複することになるコアのプリフェッチのロジックを無効にすること。
 * @param {emptyArg} _
 * @param {pluginOptions} pluginOptions
 * @returns {boolean} コアのプリフェッチを無効にすべきか
 * @example
 * exports.disableCorePrefetching = () => true
 */
export const disableCorePrefetching = true

/**
 * プラグインが、`ReactDOM.createRoot`/`render` の関数呼び出しを独自のレンダラーに置き換えられるようにする。
 * @param {emptyArg} _
 * @param {pluginOptions} pluginOptions
 * @returns {Function} このメソッドは、`ReactDOM.createRoot`/`render` と同じシグネチャの関数を返すこと
 *
 * _注:_
 * 詳しくは、React のドキュメントの [`ReactDOM.createRoot`/`render`](https://reactjs.org/docs/react-dom-client.html#createroot) を参照。
 * `ReactDOM.createRoot`/`render` が使えるのは React 18 以降だけであり、それより前のバージョンでは [`ReactDOM.render`](https://reactjs.org/docs/react-dom.html#render) を使う必要があることに注意。
 * @example
 * exports.replaceHydrateFunction = () => {
 *   return (element, container) => {
 *     const root = ReactDOM.createRoot(container)
 *     root.render(element)
 *   }
 * }
 */
export const replaceHydrateFunction = true

/**
 * Service Worker がインストールされたことをプラグインに知らせる。
 * @param {object} $0
 * @param {object} $0.serviceWorker Service Worker のインスタンス。
 * @param {pluginOptions} pluginOptions
 */
export const onServiceWorkerInstalled = true

/**
 * Service Worker に利用可能な更新があることをプラグインに知らせる。
 * @param {object} $0
 * @param {object} $0.serviceWorker Service Worker のインスタンス。
 * @param {pluginOptions} pluginOptions
 */
export const onServiceWorkerUpdateFound = true

/**
 * Service Worker がバックグラウンドで更新され、変更を適用するために
 * ページを再読み込みする準備ができたことをプラグインに知らせる。
 * @param {object} $0
 * @param {object} $0.serviceWorker Service Worker のインスタンス。
 * @param {pluginOptions} pluginOptions
 */
export const onServiceWorkerUpdateReady = true

/**
 * Service Worker がアクティブになったことをプラグインに知らせる。
 * @param {object} $0
 * @param {object} $0.serviceWorker Service Worker のインスタンス。
 * @param {pluginOptions} pluginOptions
 */
export const onServiceWorkerActive = true

/**
 * Service Worker が不要（redundant）になったことをプラグインに知らせる。
 * @param {object} $0
 * @param {object} $0.serviceWorker Service Worker のインスタンス。
 * @param {pluginOptions} pluginOptions
 */
export const onServiceWorkerRedundant = true

/**
 * React が、レンダリング中、ライフサイクルメソッドの中、またはツリー全体のコンストラクターの中でエラーを捕捉したときに呼ばれる。
 * これは React 19 のルートオプション `onCaughtError` に対応する。
 * @param {object} $0
 * @param {Error} $0.error 捕捉されたエラー。
 * @param {object} $0.errorInfo componentStack を含む、エラーの追加情報。
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onCaughtError = ({ error, errorInfo }) => {
 *   console.log('Caught error:', error.message)
 *   // Log to external error reporting service
 * }
 */
export const onCaughtError = true

/**
 * React が、非同期のイベント（setTimeout、requestIdleCallback など）で投げられたエラーを受け取ったときに呼ばれる。
 * これは React 19 のルートオプション `onUncaughtError` に対応する。
 * @param {object} $0
 * @param {Error} $0.error 投げられたエラー。
 * @param {object} $0.errorInfo componentStack を含む、エラーの追加情報。
 * @param {pluginOptions} pluginOptions
 * @example
 * exports.onUncaughtError = ({ error, errorInfo }) => {
 *   console.error('Uncaught error:', error.message)
 *   // Log to external error reporting service
 * }
 */
export const onUncaughtError = true
