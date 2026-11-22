/**
 * `gatsby-config.js` で定義されたオプションを持つオブジェクト
 * @typedef {object} pluginOptions
 */

/**
 * デフォルトのサーバーレンダラーを置き換える。Redux や css-in-js ライブラリなど、
 * サーバーレンダリングに独自のセットアップが必要なものと統合するときに役立つ。
 * @param {object} $0
 * @param {string} $0.pathname 現在レンダリングしているページのパス名。
 * @param {ReactNode} $0.bodyComponent ページの本文としてレンダリングする React 要素
 * @param {function} $0.replaceBodyHTMLString レンダリングした HTML 文字列を渡して
 * 呼び出す。**警告** 複数のプラグインがこの API を実装している場合は、
 * 最後のプラグインが「勝つ」。TODO これに対する自動の警告を実装する。
 * @param {function} $0.setHeadComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `headComponents` 配列に追加する。
 * @param {function} $0.setHtmlAttributes props のオブジェクトを取り、
 * `<html>` コンポーネントへ展開する。
 * @param {function} $0.setBodyAttributes props のオブジェクトを取り、
 * `<body>` コンポーネントへ展開する。
 * @param {function} $0.setPreBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `preBodyComponents` 配列に追加する。
 * @param {function} $0.setPostBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `postBodyComponents` 配列に追加する。
 * @param {function} $0.setBodyProps データのオブジェクトを取り、他の body props と
 * マージして `bodyProps` として `html.js` へ渡す。
 * @param {pluginOptions} pluginOptions
 * @returns {void | Promise<void>}
 * @example
 * // From gatsby-plugin-glamor
 * const { renderToString } = require("react-dom/server")
 * const inline = require("glamor-inline")
 *
 * exports.replaceRenderer = ({ bodyComponent, replaceBodyHTMLString }) => {
 *   const bodyHTML = renderToString(bodyComponent)
 *   const inlinedHTML = inline(bodyHTML)
 *
 *   replaceBodyHTMLString(inlinedHTML)
 * }
 */
exports.replaceRenderer = true

/**
 * HTML のビルド中に Gatsby がページをサーバーレンダリングするたびに呼ばれる。
 * `html.js` でレンダリングする head と body のコンポーネントを設定できる。
 *
 * Gatsby は HTML を 2 パスでレンダリングする。まず各ページの body だけを
 * レンダリングし、その結果の body の HTML 文字列を `body` prop として
 * `html.js` へ渡してレンダリングを完了する。
 *
 * 独自のコンポーネントを `html.js` へ渡せると便利なことが多い。
 * たとえば、サーバーレンダリングに対応した React.js のライブラリでは、
 * レンダリング中に生成したデータを取り出して HTML に追加するパターンが
 * 非常によく使われる。
 *
 * [`replaceRenderer`](#replaceRenderer) よりも、この API を使うことが望ましい。
 * この API は複数のプラグインが実装できるが、サーバーレンダリングを
 * 引き受けられるプラグインは 1 つだけだからである。ただし、プラグインが
 * サーバーレンダリングを引き受ける必要がある場合は、そちらを使うこと
 * @param {object} $0
 * @param {string} $0.pathname 現在レンダリングしているページのパス名。
 * @param {function} $0.setHeadComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `headComponents` 配列に追加する。
 * @param {function} $0.setHtmlAttributes props のオブジェクトを取り、
 * `<html>` コンポーネントへ展開する。
 * @param {function} $0.setBodyAttributes props のオブジェクトを取り、
 * `<body>` コンポーネントへ展開する。
 * @param {function} $0.setPreBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `preBodyComponents` 配列に追加する。
 * @param {function} $0.setPostBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `postBodyComponents` 配列に追加する。
 * @param {function} $0.setBodyProps データのオブジェクトを取り、他の body props と
 * マージして `bodyProps` として `html.js` へ渡す。
 * @param {pluginOptions} pluginOptions
 * @example
 * // Import React so that you can use JSX in HeadComponents
 * const React = require("react")
 *
 * const HtmlAttributes = {
 *   lang: "en"
 * }
 *
 * const HeadComponents = [
 *   <script key="my-script" src="https://gatsby.dev/my-script" />
 * ]
 *
 * const BodyAttributes = {
 *   "data-theme": "dark"
 * }
 *
 * exports.onRenderBody = ({
 *   setHeadComponents,
 *   setHtmlAttributes,
 *   setBodyAttributes
 * }, pluginOptions) => {
 *   setHtmlAttributes(HtmlAttributes)
 *   setHeadComponents(HeadComponents)
 *   setBodyAttributes(BodyAttributes)
 * }
 */
exports.onRenderBody = true

/**
 * HTML のビルド中に Gatsby がページをサーバーレンダリングするたびに呼ばれる。
 * `html.js` でレンダリングする head のコンポーネントを置き換えられる。
 * 他のプラグインが追加したスクリプトやスタイルを並べ替える必要があるときに役立つ。
 * @param {object} $0
 * @param {string} $0.pathname 現在レンダリングしているページのパス名。
 * @param {Array<ReactNode>} $0.getHeadComponents 現在の `headComponents` 配列を返す。
 * @param {function} $0.replaceHeadComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `headComponents` 配列を置き換える。
 * **警告** 複数のプラグインがこの API を実装している場合は、
 * 最後のプラグインが「勝つ」。
 * @param {Array<ReactNode>} $0.getPreBodyComponents 現在の `preBodyComponents` 配列を返す。
 *  @param {function} $0.replacePreBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `preBodyComponents` 配列を置き換える。
 * **警告** 複数のプラグインがこの API を実装している場合は、
 * 最後のプラグインが「勝つ」。
 * @param {Array<ReactNode>} $0.getPostBodyComponents 現在の `postBodyComponents` 配列を返す。
 *  @param {function} $0.replacePostBodyComponents 第 1 引数にコンポーネントの配列を取り、
 * `html.js` コンポーネントへ渡される `postBodyComponents` 配列を置き換える。
 * **警告** 複数のプラグインがこの API を実装している場合は、
 * 最後のプラグインが「勝つ」。
 * @param {pluginOptions} pluginOptions
 * @example
 * // Move Typography.js styles to the top of the head section so they're loaded first.
 * exports.onPreRenderHTML = ({ getHeadComponents, replaceHeadComponents }) => {
 *   const headComponents = getHeadComponents()
 *   headComponents.sort((x, y) => {
 *     if (x.key === 'TypographyStyle') {
 *       return -1
 *     } else if (y.key === 'TypographyStyle') {
 *       return 1
 *     }
 *     return 0
 *   })
 *   replaceHeadComponents(headComponents)
 * }
 */
exports.onPreRenderHTML = true

/**
 * プラグインがページ要素をラップできるようにする。
 *
 * ページが切り替わってもアンマウントされないラッパーコンポーネントを、
 * ページの周りに配置するときに役立つ。コンテキストプロバイダーを設定する場合は [wrapRootElement](#wrapRootElement) を使うこと。
 *
 * _注:_
 * Gatsby の [Browser API](/docs/browser-apis/#wrapPageElement) にも同等のフックがある。
 * 両方の API を併用することを推奨する。
 * 使用例は [Using i18n](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-i18n) を参照。
 * @param {object} $0
 * @param {ReactNode} $0.element Gatsby が構築した「Page」の React 要素。
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
exports.wrapPageElement = true

/**
 * プラグインがルート要素をラップできるようにする。
 *
 * アプリケーション全体をラップするコンテキストプロバイダーを設定するときに役立つ。
 * ページの周りに常駐する UI 要素を配置する場合は [wrapPageElement](#wrapPageElement) を使うこと。
 *
 * _注:_
 * Gatsby の [Browser API](/docs/browser-apis/#wrapRootElement) にも同等のフックがある。
 * 両方の API を併用することを推奨する。
 * 使用例は [Using redux](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-redux) を参照。
 * @param {object} $0
 * @param {string} $0.pathname 現在レンダリングしているページのパス名。
 * @param {ReactNode} $0.element Gatsby が構築した「Root」の React 要素。
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
exports.wrapRootElement = true
