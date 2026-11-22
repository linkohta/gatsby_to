const React = require(`react`)
const ThemeProvider = require(`react-jss`).ThemeProvider

// クライアントで追加されるものと衝突しないよう、サーバーで生成された JSS の style タグを取り除く
exports.onInitialClientRender = () => {
  const ssStyles = window.document.getElementById(`server-side-jss`)
  if (ssStyles) {
    ssStyles.parentNode.removeChild(ssStyles)
  }
}
// eslint-disable-next-line react/prop-types
exports.wrapRootElement = ({ element }, options) => {
  const theme = options.theme || {}
  return <ThemeProvider theme={theme}>{element}</ThemeProvider>
}
