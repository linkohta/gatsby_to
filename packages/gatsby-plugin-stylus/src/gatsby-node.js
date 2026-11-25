/**
 * 使い方:
 *
 * // gatsby-config.js
 * plugins: [
 *  `gatsby-plugin-stylus`,
 * ],
 *
 * // オプション付きの使い方:
 *
 * // gatsby-config.js
 * plugins: [
 *   {
 *     resolve: `gatsby-plugin-stylus`,
 *     options: {
 *       use: [],
 *       import: []
 *     },
 *   },
 * ],
 */

const resolve = require(`./resolve`)

// stylus-loader 自身のオプション。これ以外は stylus のオプションとして扱う
const LOADER_OPTIONS = [
  `implementation`,
  `sourceMap`,
  `webpackImporter`,
  `additionalData`,
]

/**
 * プラグインのオプションを、stylus-loader のオプションの形にする。
 *
 * stylus-loader 4 以降は、stylus のオプション（`use` や `import` など）を `stylusOptions` に
 * まとめて渡す必要があり、それ以外のキーを渡すとエラーになる。このプラグインでは、これまでどおり
 * stylus のオプションをプラグインのオプションの直下に書けるようにしている。
 */
function getStylusLoaderOptions({ stylusOptions, ...options }) {
  const loaderOptions = {}
  const restOptions = {}

  for (const [key, value] of Object.entries(options)) {
    if (LOADER_OPTIONS.includes(key)) {
      loaderOptions[key] = value
    } else {
      restOptions[key] = value
    }
  }

  if (typeof stylusOptions === `function`) {
    // 関数の場合は、関数が返すオプションに、直下に書かれたオプションを合わせる
    loaderOptions.stylusOptions = loaderContext => {
      return { ...restOptions, ...stylusOptions(loaderContext) }
    }
  } else {
    loaderOptions.stylusOptions = { ...restOptions, ...stylusOptions }
  }

  return loaderOptions
}

exports.onCreateWebpackConfig = (
  { actions, stage, loaders },
  {
    cssLoaderOptions = {},
    postCssPlugins,
    // Gatsby が必ず追加するオプションで、stylus のものではない
    plugins: _plugins,
    ...stylusLoaderOptions
  }
) => {
  const isSSR = [`develop-html`, `build-html`].includes(stage)
  const { setWebpackConfig } = actions

  const stylusLoader = {
    loader: resolve(`stylus-loader`),
    options: getStylusLoaderOptions(stylusLoaderOptions),
  }

  const stylusRule = {
    test: /\.styl$/,
    use: isSSR
      ? [loaders.null()]
      : [
          loaders.miniCssExtract(),
          loaders.css({
            importLoaders: 2,
            ...cssLoaderOptions,
            modules: false,
          }),
          loaders.postcss({ plugins: postCssPlugins }),
          stylusLoader,
        ],
  }

  const stylusRuleModules = {
    test: /\.module\.styl$/,
    use: [
      !isSSR &&
        loaders.miniCssExtract({
          modules: {
            namedExport: cssLoaderOptions.modules?.namedExport ?? true,
          },
        }),
      loaders.css({
        ...cssLoaderOptions,
        importLoaders: 1,
        modules: cssLoaderOptions.modules ?? true,
      }),
      loaders.postcss({ plugins: postCssPlugins }),
      stylusLoader,
    ].filter(Boolean),
  }

  const configRules = [
    {
      oneOf: [stylusRuleModules, stylusRule],
    },
  ]

  setWebpackConfig({
    module: {
      rules: configRules,
    },
  })
}
