import resolve from "./resolve"

exports.onCreateWebpackConfig = (
  { actions, stage, loaders },
  {
    cssLoaderOptions = {},
    postCssPlugins,
    useResolveUrlLoader,
    sassRuleTest,
    sassRuleModulesTest,
    sassOptions = {},
    // eslint-disable-next-line no-unused-vars
    plugins,
    additionalData = undefined,
    ...sassLoaderOptions
  }
) => {
  const { setWebpackConfig } = actions
  const isSSR = [`develop-html`, `build-html`].includes(stage)

  const sassLoader = {
    loader: resolve(`sass-loader`),
    options: {
      sourceMap: useResolveUrlLoader ? true : undefined,
      sassOptions,
      additionalData,
      ...sassLoaderOptions,
    },
  }

  const sassRule = {
    test: sassRuleTest || /\.s(a|c)ss$/,
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
        ],
  }

  const sassRuleModules = {
    test: sassRuleModulesTest || /\.module\.s(a|c)ss$/,
    use: [
      !isSSR &&
        loaders.miniCssExtract({
          modules: {
            namedExport: cssLoaderOptions.modules?.namedExport ?? true,
          },
        }),
      loaders.css({
        importLoaders: 2,
        ...cssLoaderOptions,
        modules: cssLoaderOptions.modules ?? true,
      }),
      loaders.postcss({ plugins: postCssPlugins }),
    ].filter(Boolean),
  }
  if (useResolveUrlLoader && !isSSR) {
    sassRule.use.push({
      loader: `resolve-url-loader`,
      options: useResolveUrlLoader.options ? useResolveUrlLoader.options : {},
    })
    sassRuleModules.use.push({
      loader: `resolve-url-loader`,
      options: useResolveUrlLoader.options ? useResolveUrlLoader.options : {},
    })
  }

  // sass のローダーを追加する
  sassRule.use.push(sassLoader)
  sassRuleModules.use.push(sassLoader)

  const configRules = [
    {
      oneOf: [sassRuleModules, sassRule],
    },
  ]

  setWebpackConfig({
    module: {
      rules: configRules,
    },
  })
}

const MATCH_ALL_KEYS = /^/

// 古い API のオプションのうち、新しい名前に置き換わったものを、置き換え先を示してエラーにする
const removedSassOption = (Joi, replacement) =>
  Joi.forbidden().messages({
    "any.unknown": `{{#label}} is not supported by sass-loader 17 and later. Use "${replacement}" instead`,
  })
exports.pluginOptionsSchema = function ({ Joi }) {
  return Joi.object({
    implementation: Joi.object({})
      .unknown(true)
      .description(
        `By default sass-embedded is used when it is installed, otherwise the Dart implementation of Sass (sass). To use a specific implementation, pass it into the options as the implementation`
      ),
    additionalData: Joi.alternatives()
      .try(Joi.string(), Joi.function())
      .description(
        `Prepends Sass/SCSS code before the actual entry file. In this case, the sass-loader will not override the data option but just prepend the entry's content. Learn more at: https://webpack.js.org/loaders/sass-loader/#additionaldata`
      ),
    cssLoaderOptions: Joi.object({})
      .unknown(true)
      .description(
        `Pass in options for css-loader: https://github.com/webpack-contrib/css-loader/tree/version-1#options`
      ),
    postCssPlugins: Joi.array()
      .items(Joi.any())
      .description(`An array of postCss plugins`),
    sassRuleTest: Joi.object()
      .instance(RegExp)
      .description(`Override the file regex for Sass`),
    sassRuleModulesTest: Joi.object()
      .instance(RegExp)
      .description(`Override the file regex for Sass`),
    useResolveUrlLoader: Joi.alternatives().try(
      Joi.boolean(),
      Joi.object({}).unknown(true)
    )
      .description(`This plugin resolves url() paths relative to the entry SCSS/Sass file not – as might be expected – the location relative to the declaration. Under the hood, it makes use of sass-loader and this is documented in the readme.

        Using resolve-url-loader provides a workaround, if you want to use relative url just install the plugin and then add it to your Sass plugin options configuration.`),
    // TODO: 関数も許可できるよう alternatives() を使う。現在はスキーマの検証（テスト）に何らかのバグがある
    // sass-loader 17 は、Sass の新しい JavaScript API（https://sass-lang.com/documentation/js-api/interfaces/options/）
    // だけに対応している。古い API のオプションは Sass に無視されるので、新しい名前に置き換わったものは、
    // 気付けるようにここでエラーにする
    sassOptions: Joi.object({
      loadPaths: Joi.array()
        .items(Joi.string())
        .description(
          `Paths in which to look for stylesheets loaded by rules like @use and @import.`
        ),
      style: Joi.string()
        .valid(`expanded`, `compressed`)
        .description(`The output style of the compiled CSS.`),
      syntax: Joi.string()
        .valid(`scss`, `indented`, `css`)
        .description(`The syntax to use to parse the entrypoint stylesheet.`),
      importers: Joi.array()
        .items(Joi.any())
        .description(
          `Custom importers that control how Sass resolves loads from rules like @use and @import.`
        ),
      functions: Joi.object()
        .pattern(MATCH_ALL_KEYS, Joi.function())
        .description(
          `Additional built-in Sass functions that are available in all stylesheets. The keys are Sass function signatures like you'd write for the @function rule.`
        ),
      quietDeps: Joi.boolean().description(
        `true silences compiler warnings from stylesheets loaded by using the loadPaths or importers options.`
      ),
      verbose: Joi.boolean().description(
        `true prints every single deprecation warning Sass encounters.`
      ),
      silenceDeprecations: Joi.array()
        .items(Joi.any())
        .description(`A set of active deprecations to ignore.`),
      fatalDeprecations: Joi.array()
        .items(Joi.any())
        .description(`A set of deprecations to treat as fatal.`),
      futureDeprecations: Joi.array()
        .items(Joi.any())
        .description(`A set of future deprecations to opt into early.`),
      charset: Joi.boolean().description(
        `false prevents Sass from emitting a @charset declaration or a UTF-8 byte-order mark.`
      ),
      sourceMapIncludeSources: Joi.boolean().description(
        `true includes the contents of the stylesheets in the source map.`
      ),
      includePaths: removedSassOption(Joi, `loadPaths`),
      outputStyle: removedSassOption(Joi, `style`),
      indentedSyntax: removedSassOption(Joi, `syntax`),
      importer: removedSassOption(Joi, `importers`),
    }).unknown(true),
  }).unknown(true)
}
