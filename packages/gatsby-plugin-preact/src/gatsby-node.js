const PreactRefreshPlugin = require(`@prefresh/webpack`)

const FRAMEWORK_BUNDLES_PREACT = [
  `preact`,
  `react`,
  `react-dom`,
  `scheduler`,
  `prop-types`,
]

// この正規表現は、フレームワークのライブラリの入れ子になったコピーを無視し、それらが issuer と一緒にバンドルされるようにする
const FRAMEWORK_BUNDLES_REGEX_PREACT = new RegExp(
  `(?<!node_modules.*)[\\\\/]node_modules[\\\\/](${FRAMEWORK_BUNDLES_PREACT.join(
    `|`
  )})[\\\\/]`
)

export function onCreateBabelConfig({ actions, stage }) {
  if (stage === `develop`) {
    // フックを有効にするため、react-refresh の babel プラグインを有効にする
    // @see https://github.com/JoviDeCroock/prefresh/tree/master/packages/webpack#using-hooks
    actions.setBabelPlugin({
      name: `@prefresh/babel-plugin`,
      stage,
    })
  }
}

export function onCreateWebpackConfig({ stage, actions, getConfig }) {
  const webpackPlugins = []
  const webpackConfig = getConfig()

  if (webpackConfig.resolve?.alias) {
    delete webpackConfig.resolve.alias.react
    delete webpackConfig.resolve.alias[`react-dom`]
  }

  if (stage === `develop`) {
    webpackPlugins.push(
      new PreactRefreshPlugin({
        overlay: {
          module: require.resolve(`gatsby/dist/utils/fast-refresh-module`),
        },
      })
    )

    // React の refresh プラグインを取り除く。代わりに preact の refresh を追加したい。
    webpackConfig.plugins = webpackConfig.plugins.filter(
      plugin => plugin.constructor.name !== `ReactRefreshPlugin`
    )

    // webpack-hot-middleware/client を commons エントリーに追加する
    webpackConfig.entry.commons.unshift(
      `@gatsbyjs/webpack-hot-middleware/client`
    )
  }

  // preact を framework バンドルに追加する
  if (stage === `build-javascript` || stage === `develop`) {
    if (
      webpackConfig?.optimization?.splitChunks?.cacheGroups?.framework?.test
    ) {
      // react のライブラリを preact に置き換える
      webpackConfig.optimization.splitChunks.cacheGroups.framework.test =
        FRAMEWORK_BUNDLES_REGEX_PREACT
    }
  }

  actions.replaceWebpackConfig(webpackConfig)

  actions.setWebpackConfig({
    resolve: {
      alias: {
        react: `preact/compat`,
        "react-dom/test-utils": `preact/test-utils`,
        "react-dom": `preact/compat`,
        "react/jsx-runtime": `preact/jsx-runtime`,
      },
    },
    plugins: webpackPlugins,
  })
}
