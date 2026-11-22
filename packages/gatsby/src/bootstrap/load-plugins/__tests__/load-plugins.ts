import { loadPlugins } from "../index"
import { slash } from "gatsby-core-utils"
import reporter from "gatsby-cli/lib/reporter"
import { IFlattenedPlugin } from "../types"

const mockNonIncompatibleWarn = jest.fn()

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {
    error: jest.fn(),
    panic: jest.fn(),
    panicOnBuild: jest.fn(),
    log: jest.fn(),
    warn: jest.fn((...args) => {
      // 互換性の警告を取り除く。現状では
      // Plugin X is not compatible with your gatsby version X - It requires X
      // という警告が大量に出るためである
      if (!args[0].includes(`is not compatible with your gatsby version`)) {
        mockNonIncompatibleWarn(...args)
      }
    }),
    success: jest.fn(),
    info: jest.fn(),
  }
})

// 以前は、babel が src にある ts のプラグインファイル（gatsby-node ファイルなど）をその場でトランスパイルしていたので、
// 事前に compileGatsbyFiles を実行しなくても（実際の場面では実行される）、require やテストができた。
// ESM に対応するために import へ切り替えた後は、ファイルパスの解決先を、dist にある実際のコンパイル済み JS ファイルに向けている。
jest.mock(`../../resolve-js-file-path`, () => {
  return {
    resolveJSFilepath: jest.fn(({ filePath }: { filePath: string }) => {
      if (filePath.includes(`load-plugins/__tests__/fixtures`)) {
        return filePath
      }

      return `${filePath.replace(`src`, `dist`)}.js`
    }),
    maybeAddFileProtocol: jest.fn(val => val),
  }
})

jest.mock(`resolve-from`)
const mockProcessExit = jest.spyOn(process, `exit`).mockImplementation(() => {})

afterEach(() => {
  Object.keys(reporter).forEach(method => {
    reporter[method].mockClear()
  })
  mockProcessExit.mockClear()
})

describe(`Load plugins`, () => {
  /**
   * 解決されたパスとバージョン文字列を置き換える。
   * 解決されたパスはプラットフォームによって変わる。
   * バージョンは更新されることがある（デフォルトの設定で外部のプラグインを使っている）。
   * どちらもスナップショットの差分の原因になる。
   */
  const replaceFieldsThatCanVary = (
    plugins: Array<IFlattenedPlugin>
  ): Array<IFlattenedPlugin> =>
    plugins.map(plugin => {
      if (plugin.pluginOptions && plugin.pluginOptions.path) {
        plugin.pluginOptions = {
          ...plugin.pluginOptions,
          path: plugin.pluginOptions.path.replace(
            slash(process.cwd()),
            `<PROJECT_ROOT>`
          ),
        }
      }

      return {
        ...plugin,
        id: ``,
        resolve: ``,
        version: `1.0.0`,
      }
    })

  it(`Load plugins for a site`, async () => {
    let plugins = await loadPlugins({ plugins: [] }, process.cwd())

    plugins = replaceFieldsThatCanVary(plugins)

    expect(plugins).toMatchSnapshot()
  })

  it(`Loads plugins defined with an object but without an options key`, async () => {
    const config = {
      plugins: [
        {
          resolve: `___TEST___`,
        },
      ],
    }

    let plugins = await loadPlugins(config, process.cwd())

    plugins = replaceFieldsThatCanVary(plugins)

    expect(plugins).toMatchSnapshot()
  })

  it(`Throws an error when a plugin is defined with an option key`, async () => {
    expect.assertions(1)
    const config = {
      plugins: [
        {
          resolve: `___TEST___`,
          option: {
            test: true,
          },
        },
      ],
    }

    try {
      await loadPlugins(config, process.cwd())
    } catch (err) {
      expect(err.message).toMatchSnapshot()
    }
  })

  it(`Overrides the options for gatsby-plugin-page-creator`, async () => {
    const config = {
      plugins: [
        {
          resolve: `gatsby-plugin-page-creator`,
          options: {
            path: `${__dirname}/src/pages`,
            ignore: [`___Test___.(js|ts)?(x)`],
          },
        },
      ],
    }

    let plugins = await loadPlugins(config, process.cwd())

    plugins = replaceFieldsThatCanVary(plugins)

    expect(plugins).toMatchSnapshot()
  })

  describe(`TypeScript support`, () => {
    it(`loads gatsby-plugin-typescript if not provided`, async () => {
      const config = {
        plugins: [],
      }

      let plugins = await loadPlugins(config, process.cwd())

      plugins = replaceFieldsThatCanVary(plugins)

      expect(plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: `gatsby-plugin-typescript`,
          }),
        ])
      )
    })

    it(`uses the user provided plugin-typescript if provided`, async () => {
      const config = {
        plugins: [
          {
            resolve: `gatsby-plugin-typescript`,
            options: {
              jsxPragma: `h`,
            },
          },
        ],
      }

      let plugins = await loadPlugins(config, process.cwd())

      plugins = replaceFieldsThatCanVary(plugins)

      expect(plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            browserAPIs: [],
            id: ``,
            name: `gatsby-plugin-typescript`,
            nodeAPIs: [
              `pluginOptionsSchema`,
              `resolvableExtensions`,
              `onCreateBabelConfig`,
              `onCreateWebpackConfig`,
            ],
            pluginOptions: {
              allExtensions: false,
              isTSX: false,
              jsxPragma: `h`,
              plugins: [],
            },
            resolve: ``,
            ssrAPIs: [],
            version: `1.0.0`,
          }),
        ])
      )
    })

    it(`does not add gatsby-plugin-typescript if it exists in config.plugins`, async () => {
      const config = {
        plugins: [
          `gatsby-plugin-typescript`,
          { resolve: `gatsby-plugin-typescript` },
        ],
      }

      let plugins = await loadPlugins(config, process.cwd())

      plugins = replaceFieldsThatCanVary(plugins)

      const tsplugins = plugins.filter(
        (plugin: { name: string }) => plugin.name === `gatsby-plugin-typescript`
      )

      expect(tsplugins.length).toEqual(1)
    })
  })

  describe(`plugin options validation`, () => {
    it(`throws a structured error with invalid plugin options`, async () => {
      const invalidPlugins = [
        {
          resolve: `gatsby-plugin-google-analytics`,
          options: {
            trackingId: 123,
            anonymize: `not a boolean`,
          },
        },
        {
          resolve: `gatsby-plugin-google-analytics`,
          options: {
            anonymize: `still not a boolean`,
          },
        },
      ]
      await loadPlugins(
        {
          plugins: invalidPlugins,
        },
        process.cwd()
      )

      expect(reporter.error as jest.Mock).toHaveBeenCalledTimes(
        invalidPlugins.length
      )
      expect((reporter.error as jest.Mock).mock.calls[0])
        .toMatchInlineSnapshot(`
        Array [
          Object {
            "context": Object {
              "configDir": null,
              "pluginName": "gatsby-plugin-google-analytics",
              "validationErrors": Array [
                Object {
                  "context": Object {
                    "key": "trackingId",
                    "label": "trackingId",
                    "value": 123,
                  },
                  "message": "\\"trackingId\\" must be a string",
                  "path": Array [
                    "trackingId",
                  ],
                  "type": "string.base",
                },
                Object {
                  "context": Object {
                    "key": "anonymize",
                    "label": "anonymize",
                    "value": "not a boolean",
                  },
                  "message": "\\"anonymize\\" must be a boolean",
                  "path": Array [
                    "anonymize",
                  ],
                  "type": "boolean.base",
                },
              ],
            },
            "id": "11331",
          },
        ]
      `)
      expect((reporter.error as jest.Mock).mock.calls[1])
        .toMatchInlineSnapshot(`
        Array [
          Object {
            "context": Object {
              "configDir": null,
              "pluginName": "gatsby-plugin-google-analytics",
              "validationErrors": Array [
                Object {
                  "context": Object {
                    "key": "trackingId",
                    "label": "trackingId",
                  },
                  "message": "\\"trackingId\\" is required",
                  "path": Array [
                    "trackingId",
                  ],
                  "type": "any.required",
                },
                Object {
                  "context": Object {
                    "key": "anonymize",
                    "label": "anonymize",
                    "value": "still not a boolean",
                  },
                  "message": "\\"anonymize\\" must be a boolean",
                  "path": Array [
                    "anonymize",
                  ],
                  "type": "boolean.base",
                },
              ],
            },
            "id": "11331",
          },
        ]
      `)
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it(`allows unknown options`, async () => {
      const plugins = [
        {
          resolve: `gatsby-plugin-google-analytics`,
          options: {
            trackingId: `yes`,
            doesThisExistInTheSchema: `no`,
          },
        },
      ]
      await loadPlugins(
        {
          plugins,
        },
        process.cwd()
      )

      expect(reporter.error as jest.Mock).toHaveBeenCalledTimes(0)
      expect(mockNonIncompatibleWarn as jest.Mock).toHaveBeenCalledTimes(1)
      expect((mockNonIncompatibleWarn as jest.Mock).mock.calls[0])
        .toMatchInlineSnapshot(`
        Array [
          "Warning: there are unknown plugin options for \\"gatsby-plugin-google-analytics\\": doesThisExistInTheSchema
        Please open an issue at https://ghub.io/gatsby-plugin-google-analytics if you believe this option is valid.",
        ]
      `)
      expect(mockProcessExit).not.toHaveBeenCalled()
    })

    it(`defaults plugin options to the ones defined in the schema`, async () => {
      let plugins = await loadPlugins(
        {
          plugins: [
            {
              resolve: `gatsby-plugin-google-analytics`,
              options: {
                trackingId: `fake`,
              },
            },
          ],
        },
        process.cwd()
      )

      plugins = replaceFieldsThatCanVary(plugins)

      expect(
        plugins.find(plugin => plugin.name === `gatsby-plugin-google-analytics`)
          .pluginOptions
      ).toEqual({
        // デフォルト値を持つオプションはすべて定義されている
        anonymize: false,
        enableWebVitalsTracking: false,
        exclude: [],
        head: false,
        pageTransitionDelay: 0,
        plugins: [],
        respectDNT: false,
        trackingId: `fake`,
      })
    })

    it(`validates subplugin schemas`, async () => {
      await loadPlugins(
        {
          plugins: [
            {
              resolve: `gatsby-transformer-remark`,
              options: {
                plugins: [
                  {
                    resolve: `gatsby-remark-autolink-headers`,
                    options: {
                      maintainCase: `should be boolean`,
                    },
                  },
                ],
              },
            },
          ],
        },
        process.cwd()
      )

      expect(reporter.error as jest.Mock).toHaveBeenCalledTimes(1)
      expect((reporter.error as jest.Mock).mock.calls[0])
        .toMatchInlineSnapshot(`
        Array [
          Object {
            "context": Object {
              "configDir": null,
              "pluginName": "gatsby-remark-autolink-headers",
              "validationErrors": Array [
                Object {
                  "context": Object {
                    "key": "maintainCase",
                    "label": "maintainCase",
                    "value": "should be boolean",
                  },
                  "message": "\\"maintainCase\\" must be a boolean",
                  "path": Array [
                    "maintainCase",
                  ],
                  "type": "boolean.base",
                },
              ],
            },
            "id": "11331",
          },
        ]
      `)
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it(`validates subplugin schemas (if not in options.plugins)`, async () => {
      await loadPlugins(
        {
          plugins: [
            {
              resolve: `gatsby-plugin-mdx`,
              options: {
                gatsbyRemarkPlugins: [
                  {
                    resolve: `gatsby-remark-autolink-headers`,
                    options: {
                      maintainCase: `should be boolean`,
                    },
                  },
                ],
              },
            },
          ],
        },
        process.cwd()
      )

      expect(reporter.error as jest.Mock).toHaveBeenCalledTimes(1)
      expect((reporter.error as jest.Mock).mock.calls[0])
        .toMatchInlineSnapshot(`
        Array [
          Object {
            "context": Object {
              "configDir": null,
              "pluginName": "gatsby-remark-autolink-headers",
              "validationErrors": Array [
                Object {
                  "context": Object {
                    "key": "maintainCase",
                    "label": "maintainCase",
                    "value": "should be boolean",
                  },
                  "message": "\\"maintainCase\\" must be a boolean",
                  "path": Array [
                    "maintainCase",
                  ],
                  "type": "boolean.base",
                },
              ],
            },
            "id": "11331",
          },
        ]
      `)
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it(`subplugins are resolved using "main" in package.json`, async () => {
      // fixtures/subplugins/node_modules/gatsby-plugin-child-with-main/package.json では
      // "main" フィールドが "lib/index.js" を指している
      const plugins = await loadPlugins(
        {
          plugins: [
            {
              resolve: `gatsby-plugin-parent`,
              options: {
                testSubplugins: [
                  `gatsby-plugin-child-no-main`,
                  `gatsby-plugin-child-with-main`,
                ],
              },
            },
          ],
        },
        __dirname + `/fixtures/subplugins`
      )

      // サブプラグインのエントリーファイルの "module.exports" には、テストのために
      // 文字列だけを入れている（サブプラグインの項目の "module" フィールドを検証できるようにするため）
      expect(
        plugins.find(plugin => plugin.name === `gatsby-plugin-parent`)
          ?.pluginOptions?.testSubplugins
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: `gatsby-plugin-child-with-main`,
            module: `export-test-gatsby-plugin-child-with-main`,
            modulePath: expect.stringMatching(
              /gatsby-plugin-child-with-main[/\\]lib[/\\]index\.js$/
            ),
          }),
          expect.objectContaining({
            name: `gatsby-plugin-child-no-main`,
            module: `export-test-gatsby-plugin-child-no-main`,
            modulePath: expect.stringMatching(
              /gatsby-plugin-child-no-main[/\\]index\.js$/
            ),
          }),
        ])
      )
    })

    it(`validates local plugin schemas using require.resolve`, async () => {
      await loadPlugins(
        {
          plugins: [
            {
              resolve: require.resolve(`./fixtures/local-plugin`),
              options: {
                optionalString: 1234,
              },
            },
          ],
        },
        process.cwd()
      )

      expect(reporter.error as jest.Mock).toHaveBeenCalledTimes(1)
      expect((reporter.error as jest.Mock).mock.calls[0])
        .toMatchInlineSnapshot(`
        Array [
          Object {
            "context": Object {
              "configDir": null,
              "pluginName": "<PROJECT_ROOT>/packages/gatsby/src/bootstrap/load-plugins/__tests__/fixtures/local-plugin/index.js",
              "validationErrors": Array [
                Object {
                  "context": Object {
                    "key": "required",
                    "label": "required",
                  },
                  "message": "\\"required\\" is required",
                  "path": Array [
                    "required",
                  ],
                  "type": "any.required",
                },
                Object {
                  "context": Object {
                    "key": "optionalString",
                    "label": "optionalString",
                    "value": 1234,
                  },
                  "message": "\\"optionalString\\" must be a string",
                  "path": Array [
                    "optionalString",
                  ],
                  "type": "string.base",
                },
              ],
            },
            "id": "11331",
          },
        ]
      `)
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })
  })
})
