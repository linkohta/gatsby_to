import { testPluginOptionsSchema } from "gatsby-plugin-utils"
import { pluginOptionsSchema } from "../gatsby-node"

describe(`gatsby-plugin-sass`, () => {
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

  const tests = {
    stages: [`develop`, `build-javascript`, `develop-html`, `build-html`],
    options: {
      "No options": {},
      "Sass options": {
        sassOptions: {
          loadPaths: [`absolute/path/a`, `absolute/path/b`],
        },
      },
      "sass-loader options": {
        api: `modern`,
        warnRuleAsWarning: false,
        additionalData: `$test: #000;`,
      },
      "PostCss plugins": {
        postCssPlugins: [`test1`],
      },
      "css-loader options": {
        cssLoaderOptions: {
          camelCase: false,
        },
      },
      "sass rule test options": {
        sassRuleTest: /\.global\.s(a|c)ss$/,
      },
      "sass rule modules test options": {
        sassRuleModulesTest: /\.global\.s(a|c)ss$/,
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
      if (tests.options[label]) {
        const options = tests.options[label]
        it(`Stage: ${stage} / ${label}`, () => {
          onCreateWebpackConfig({ actions, loaders, stage }, options)
          expect(actions.setWebpackConfig).toMatchSnapshot()
        })
      }
    }
  })
})

describe(`pluginOptionsSchema`, () => {
  it(`should provide meaningful errors when fields are invalid`, async () => {
    const expectedErrors = [
      `"implementation" must be of type object`,
      `"additionalData" must be one of [string, function]`,
      `"cssLoaderOptions" must be of type object`,
      `"postCssPlugins" must be an array`,
      `"sassRuleTest" must be of type object`,
      `"sassRuleModulesTest" must be of type object`,
      `"useResolveUrlLoader" must be one of [boolean, object]`,
      `"sassOptions.loadPaths" must be an array`,
      `"sassOptions.style" must be one of [expanded, compressed]`,
      `"sassOptions.syntax" must be one of [scss, indented, css]`,
      `"sassOptions.importers" must be an array`,
      `"sassOptions.functions" must be of type object`,
      `"sassOptions.quietDeps" must be a boolean`,
      `"sassOptions.verbose" must be a boolean`,
      `"sassOptions.silenceDeprecations" must be an array`,
      `"sassOptions.fatalDeprecations" must be an array`,
      `"sassOptions.futureDeprecations" must be an array`,
      `"sassOptions.charset" must be a boolean`,
      `"sassOptions.sourceMapIncludeSources" must be a boolean`,
    ]

    const { errors, isValid } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        additionalData: 123,
        implementation: `This should be a require() thing`,
        postCssPlugins: `This should be an array of postCss plugins`,
        cssLoaderOptions: `This should be an object of css-loader options`,
        sassRuleTest: `This should be a regexp`,
        sassRuleModulesTest: `This should be a regexp`,
        useResolveUrlLoader: `This should be a boolean`,
        sassOptions: {
          loadPaths: 123, // 文字列の配列であるべき
          style: `This should be expanded or compressed`,
          syntax: `This should be scss, indented or css`,
          importers: `This should be an array`,
          functions: `This should be an object of { string: function }`,
          quietDeps: `This should be a boolean`,
          verbose: `This should be a boolean`,
          silenceDeprecations: `This should be an array`,
          fatalDeprecations: `This should be an array`,
          futureDeprecations: `This should be an array`,
          charset: `This should be a boolean`,
          sourceMapIncludeSources: `This should be a boolean`,
        },
      }
    )

    expect(isValid).toBe(false)
    expect(errors).toEqual(expectedErrors)
  })

  it(`should validate the schema`, async () => {
    const { isValid, errors } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        additionalData: `$test: #000;`,
        implementation: require(`../gatsby-node.js`),
        cssLoaderOptions: { camelCase: false },
        postCssPlugins: [require(`autoprefixer`)],
        sassRuleTest: /\.global\.s(a|c)ss$/,
        sassRuleModulesTest: /\.mod\.s(a|c)ss$/,
        useResolveUrlLoader: false,
        sassOptions: {
          loadPaths: [`some`, `path`],
          style: `expanded`,
          syntax: `indented`,
          importers: [{ findFileUrl: () => null }],
          functions: {
            "headings($from: 0, $to: 6)": function () {
              return []
            },
          },
          quietDeps: true,
          verbose: true,
          silenceDeprecations: [`import`],
          fatalDeprecations: [`global-builtin`],
          futureDeprecations: [`import`],
          charset: false,
          sourceMapIncludeSources: true,
          // 新しい API にないオプションは、そのまま通す
          precision: 12,
        },
      }
    )

    expect(isValid).toBe(true)
    expect(errors).toEqual([])
  })

  it(`should reject options of the legacy Sass API that were renamed`, async () => {
    const { isValid, errors } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        sassOptions: {
          includePaths: [`some`, `path`],
          outputStyle: `expanded`,
          indentedSyntax: true,
          importer: function () {
            return null
          },
        },
      }
    )

    expect(isValid).toBe(false)
    expect(errors).toEqual([
      `"sassOptions.includePaths" is not supported by sass-loader 17 and later. Use "loadPaths" instead`,
      `"sassOptions.outputStyle" is not supported by sass-loader 17 and later. Use "style" instead`,
      `"sassOptions.indentedSyntax" is not supported by sass-loader 17 and later. Use "syntax" instead`,
      `"sassOptions.importer" is not supported by sass-loader 17 and later. Use "importers" instead`,
    ])
  })

  it(`should allow unknown options`, async () => {
    const { isValid, hasWarnings } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        webpackImporter: `unknown option`,
      }
    )

    expect(isValid).toBe(true)
    expect(hasWarnings).toBe(true)
  })
})
