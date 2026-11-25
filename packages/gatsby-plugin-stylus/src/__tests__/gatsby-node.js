describe(`gatsby-plugin-stylus`, () => {
  jest.mock(`../resolve`, () => module => `/resolved/path/${module}`)

  const actions = {
    setWebpackConfig: jest.fn(),
  }

  // ローダーの "モック"
  const loaders = {
    miniCssExtract: () => `miniCssExtract`,
    css: args => `css(${JSON.stringify(args)})`,
    postcss: args => `postcss(${JSON.stringify(args)})`,
    null: () => `null`,
  }

  const { onCreateWebpackConfig } = require(`../gatsby-node`)

  beforeEach(() => {
    actions.setWebpackConfig.mockReset()
  })

  const stylusPlugin = jest.fn().mockReturnValue(`foo`)

  const tests = {
    stages: [`develop`, `build-javascript`, `develop-html`, `build-html`],
    options: {
      "No options": {},
      "Stylus options #1": {
        use: [stylusPlugin()],
      },
      "Stylus options #2": {
        use: [stylusPlugin()],
        import: [`file.js`, `file2.js`],
      },
      "PostCss plugins": {
        postCssPlugins: [`test1`],
      },
      "stylus-loader options": {
        sourceMap: true,
        additionalData: `foo = 1`,
        import: [`file.js`],
      },
      "stylusOptions and options at the top level": {
        stylusOptions: { define: { foo: 1 }, import: [`file2.js`] },
        import: [`file.js`],
        compress: false,
      },
      "plugins option added by Gatsby": {
        plugins: [],
      },
      "css-loader use commonjs": {
        cssLoaderOptions: {
          esModule: false,
          modules: {
            namedExport: false,
          },
        },
      },
    },
  }

  tests.stages.forEach(stage => {
    for (const label in tests.options) {
      const options = tests.options[label]
      it(`Stage: ${stage} / ${label}`, () => {
        onCreateWebpackConfig(
          {
            actions,
            loaders,
            stage,
          },
          options
        )
        expect(actions.setWebpackConfig).toMatchSnapshot()
      })
    }
  })

  it(`merges options at the top level into stylusOptions given as a function`, () => {
    const stylusOptions = jest.fn().mockReturnValue({ define: { foo: 1 } })

    onCreateWebpackConfig(
      { actions, loaders, stage: `develop` },
      { stylusOptions, import: [`file.js`] }
    )

    const [config] = actions.setWebpackConfig.mock.calls[0]
    const { options } = config.module.rules[0].oneOf[1].use[3]
    const loaderContext = { resourcePath: `/a.styl` }

    expect(options.stylusOptions(loaderContext)).toEqual({
      define: { foo: 1 },
      import: [`file.js`],
    })
    expect(stylusOptions).toHaveBeenCalledWith(loaderContext)
  })
})
