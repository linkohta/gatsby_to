// 開発時に gatsby-plugin-typography をホットリロードする

let ReactDOMServer = null
let React = null
let GoogleFont = null
let typography = null

if (process.env.BUILD_STAGE === `develop`) {
  ReactDOMServer = require(`react-dom/server`)
  React = require(`react`)
  GoogleFont = require(`react-typography`).GoogleFont
  // typography は "pathToConfigModule" に設定されたファイルを指す
  const typographyConfig = require(`typography-plugin-cache-endpoint`)
  typography = typographyConfig.default || typographyConfig

  exports.onClientEntry = (a, pluginOptions) => {
    // CSS のスタイルを注入する
    typography.injectStyles()

    // "omitGoogleFont" が "true" に設定されている場合、プラグインは Google の CDN へのリンクを読み込まない
    const omit =
      typeof pluginOptions.omitGoogleFont !== `undefined`
        ? pluginOptions.omitGoogleFont
        : false

    // Google の CDN へのリンクをホットリロードする
    if (typography.options.googleFonts.length > 0 && !omit) {
      if (typeof document !== `undefined`) {
        // <link /> タグを組み立てる
        const googleFonts = ReactDOMServer.renderToStaticMarkup(
          <GoogleFont key={`GoogleFont`} typography={typography} />
        )
        // タグをパースする
        const doc = new DOMParser().parseFromString(googleFonts, `text/html`)
        const linkElement = doc.head.firstChild
        // 独自の識別子を追加する
        linkElement.setAttribute(`data-gatsby-typography`, `true`)
        const head = document.getElementsByTagName(`head`)[0]
        const elem = document.querySelector(`[data-gatsby-typography]`)
        // 古い <link /> タグを取り除く
        if (elem) {
          elem.remove()
        }
        head.appendChild(linkElement)
      }
    }
  }
}
