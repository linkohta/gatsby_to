const { loadThemes } = require(`..`)
const path = require(`path`)

describe(`loadThemes`, () => {
  test(`resolves themes and plugins from location of gatsby-config`, async () => {
    /*
      このテストで使うフィクスチャは次のような構造になっている:

      .
      ├── gatsby-config.js
      └── node_modules
          └── gatsby-theme-child
              ├── gatsby-config.js
              ├── node_modules
              │   └── gatsby-theme-parent
              │       ├── gatsby-config.js
              │       ├── node_modules
              │       │   └── gatsby-plugin-added-by-parent-theme
              │       │       └── package.json
              │       └── package.json
              └── package.json

      これにより、プラグインやテーマがルートの "node_modules" に巻き上げられていない場合を扱えることを確認する。また、yarn PnP や pnpm の要件
      （現在のパッケージの依存として宣言されたモジュールだけを import できること）を再現する。
    */

    const configFilePath = require.resolve(
      `./fixtures/resolve-from-config-location/gatsby-config`
    )
    const config = require(configFilePath)

    const {
      config: { plugins },
      themes,
    } = await loadThemes(config, {
      useLegacyThemes: false,
      configFilePath,
      rootDir: path.dirname(configFilePath),
    })

    // 暗黙のアサーション - 上のコードが `Couldn't find the "x" plugin` を投げない

    expect(plugins.length).toEqual(3)

    // ネストしたプラグインとテーマがすべて見つかる
    expect(plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolve: `gatsby-theme-child`,
        }),
        expect.objectContaining({
          resolve: `gatsby-theme-parent`,
        }),
        expect.objectContaining({
          resolve: `gatsby-plugin-added-by-parent-theme`,
        }),
      ])
    )

    expect(themes.length).toEqual(3)

    expect(themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          themeName: `gatsby-theme-child`,
          // `gatsby-theme-child` は 1 階層目の node_modules に解決される
          themeDir: path.dirname(
            require.resolve(
              `./fixtures/resolve-from-config-location/node_modules/gatsby-theme-child`
            )
          ),
        }),
        expect.objectContaining({
          themeName: `gatsby-theme-parent`,
          // `gatsby-theme-child` は 2 階層目の node_modules に解決される
          themeDir: path.dirname(
            require.resolve(
              `./fixtures/resolve-from-config-location/node_modules/gatsby-theme-child/node_modules/gatsby-theme-parent`
            )
          ),
        }),

        expect.objectContaining({
          themeName: `gatsby-plugin-added-by-parent-theme`,
          // `gatsby-theme-child` は 3 階層目の node_modules に解決される
          themeDir: path.dirname(
            require.resolve(
              `./fixtures/resolve-from-config-location/node_modules/gatsby-theme-child/node_modules/gatsby-theme-parent/node_modules/gatsby-plugin-added-by-parent-theme`
            )
          ),
        }),
      ])
    )
  })
})
