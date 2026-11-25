const resolvableExtensions = () => [`.ts`, `.tsx`]

// Babel 8 の @babel/preset-typescript は、`isTSX`、`allExtensions`、`allowDeclareFields` を
// 渡すとエラーにする。このプラグインのオプションとしては引き続き受け取り、
// Babel 8 で同じ意味になる指定に置き換える
function toPresetOptions({
  // すべてのファイルで JSX をパースする指定だった。Babel 8 では @babel/plugin-syntax-jsx で有効にする
  isTSX: _isTSX,
  allExtensions,
  // Babel 8 では常に有効で、無効にはできない
  allowDeclareFields: _allowDeclareFields,
  // Gatsby がすべてのプラグインのオプションに追加するもので、プリセットのオプションではない。
  // Babel 8 のプリセットは、知らないオプションを渡すとエラーにする
  plugins: _plugins,
  ...presetOptions
}) {
  return {
    // Babel 8 では既定値が true に変わった。true にすると、型としてだけ使っている import が
    // `import type` で書かれていない限り残るので、これまでと同じ false を既定にする
    onlyRemoveTypeImports: false,
    ...presetOptions,
    // `allExtensions` は、拡張子に関係なくすべてのファイルを TypeScript として扱う指定だった
    ...(allExtensions && { ignoreExtensions: true }),
  }
}

function onCreateBabelConfig({ actions }, options) {
  const { isTSX, allExtensions } = options

  actions.setBabelPreset({
    name: require.resolve(`@babel/preset-typescript`),
    options: toPresetOptions(options),
  })
  if (allExtensions && isTSX) {
    actions.setBabelPlugin({
      name: require.resolve(`@babel/plugin-syntax-jsx`),
    })
  }
  actions.setBabelPlugin({
    name: require.resolve(`@babel/plugin-transform-optional-chaining`),
  })
  actions.setBabelPlugin({
    name: require.resolve(
      `@babel/plugin-transform-nullish-coalescing-operator`
    ),
  })
  actions.setBabelPlugin({
    name: require.resolve(`@babel/plugin-transform-numeric-separator`),
  })
}

function onCreateWebpackConfig({ actions, loaders }) {
  if (typeof loaders?.js !== `function`) {
    return
  }

  actions.setWebpackConfig({
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: ({ resourceQuery, issuer }) => [
            loaders.js({
              isPageTemplate: /async-requires/.test(issuer),
              resourceQuery,
            }),
          ],
        },
      ],
    },
  })
}

exports.pluginOptionsSchema = ({ Joi }) =>
  Joi.object({
    isTSX: Joi.boolean().description(`Enables jsx parsing.`).default(false),
    jsxPragma: Joi.string()
      .description(`Replace the function used when compiling JSX expressions.`)
      .default(`React`),
    jsxPragmaFrag: Joi.string()
      .description(
        `Replace the function used when compiling JSX fragment expressions.`
      )
      .optional(),
    allExtensions: Joi.boolean()
      .description(`Indicates that every file should be parsed as TS or TSX.`)
      .default(false)
      .when(`isTSX`, { is: true, then: Joi.valid(true) }),
    allowNamespaces: Joi.boolean()
      .description(`Enables compilation of TypeScript namespaces.`)
      .optional(),
    allowDeclareFields: Joi.boolean()
      .description(
        `When enabled, type-only class fields are only removed if they are prefixed with the declare modifier.`
      )
      .optional(),
    onlyRemoveTypeImports: Joi.boolean()
      .description(
        `When set to true, the transform will only remove type-only imports (introduced in TypeScript 3.8).` +
          `This should only be used if you are using TypeScript >= 3.8.`
      )
      .optional(),
  })

exports.resolvableExtensions = resolvableExtensions
exports.onCreateBabelConfig = onCreateBabelConfig
exports.onCreateWebpackConfig = onCreateWebpackConfig
