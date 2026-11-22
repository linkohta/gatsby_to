const path = require(`path`)

let didRunAlready = false
let absoluteComponentPath

exports.onPreInit = ({ store }, { component }) => {
  const defaultLayoutComponentPath = `src/layouts/index`
  if (!component) {
    // v1 のレイアウトをそのまま置き換えられるよう、デフォルトは `src/layouts/index.[js|jsx]` にする
    component = path.join(
      store.getState().program.directory,
      defaultLayoutComponentPath
    )
  }

  if (didRunAlready) {
    throw new Error(
      `You can only have single instance of gatsby-plugin-layout in your gatsby-config.js`
    )
  }

  didRunAlready = true
  absoluteComponentPath = component
}

exports.onCreateWebpackConfig = ({ actions, plugins }) => {
  actions.setWebpackConfig({
    plugins: [
      plugins.define({
        GATSBY_LAYOUT_COMPONENT_PATH: JSON.stringify(absoluteComponentPath),
      }),
    ],
  })
}
