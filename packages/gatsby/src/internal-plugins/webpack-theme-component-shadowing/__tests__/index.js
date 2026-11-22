import path from "path"
import ShadowingPlugin from "../"

// Windows でも path/to/thing のようにパスを書けるようにする
const xplatPath = uri => uri.split(`/`).join(path.sep)
describe(`Component Shadowing`, () => {
  it.each([
    [
      // テーマのコンポーネントへの単純なリクエストパス
      `/some/place/a-theme/src/components/a-component`,
      {
        themeDir: `/some/place/a-theme`,
        themeName: `a-theme`,
      },
      `/components/a-component`,
    ],
    [
      // theme b の中のシャドーイングされたコンポーネントへのリクエスト
      // component-path は `a-theme/components/a-component` になるはずである
      `/some/place/theme-b/src/a-theme/components/a-component`,
      {
        themeDir: `/some/place/theme-b`,
        themeName: `theme-b`,
      },
      `/a-theme/components/a-component`,
    ],
  ])(
    `gets matching themes`,
    (componentFullPath, { themeDir, themeName }, component) => {
      const plugin = new ShadowingPlugin({
        themes: [
          `a-theme`,
          `theme-b`,
          `gatsby-theme-c`,
          `@orgname/theme-d`,
        ].map(name => {
          return {
            themeName: name,
            themeDir: xplatPath(`/some/place/${name}`),
          }
        }),
        extensions: [],
      })
      expect(plugin.getThemeAndComponent(xplatPath(componentFullPath))).toEqual(
        [
          {
            themeDir: xplatPath(themeDir),
            themeName,
          },
          xplatPath(component),
        ]
      )
    }
  )

  it.each([
    [
      {
        // issuer は `theme-b` の中にある
        issuerPath: `/some/node_modules/theme-b/src/a-theme/components/a-component`,
        // a-theme の中で自分が「シャドーの子」になっているファイルを require している
        requestPath: `/some/node_modules/a-theme/src/components/a-component`,
        userSiteDir: `/some`,
      },
      true,
    ],
    [
      {
        // issuer は `theme-b` の中にある
        issuerPath: `/some/node_modules/theme-b/src/a-theme/components/a-component`,
        // 自分が「シャドーの子」になっていない、同じ theme-b の中のファイルを require している
        // ここでの `component-path` は "components/a-component" になる
        requestPath: `/some/node_modules/theme-b/src/components/a-component`,
        userSiteDir: `/some`,
      },
      false,
    ],
    [
      {
        // issuer はユーザーのサイトの中にある
        issuerPath: `/some/src/theme-b/components/a-component`,
        // 自分が「シャドーの子」になっているファイルを require している
        requestPath: `/some/node_modules/theme-b/src/components/a-component`,
        userSiteDir: `/some`,
      },
      true,
    ],
    [
      {
        // issuer はユーザーのサイトの中にある
        issuerPath: `/some/src/@orgname/theme-d/components/a-component`,
        // 自分が「シャドーの子」になっているファイルを require している
        requestPath: `/some/node_modules/@orgname/theme-d/src/components/a-component`,
        userSiteDir: `/some`,
      },
      true,
    ],
  ])(
    `can determine if the request path is in the shadow chain for the issuer`,
    ({ issuerPath, requestPath, userSiteDir }, result) => {
      const plugin = new ShadowingPlugin({
        themes: [
          `a-theme`,
          `theme-b`,
          `gatsby-theme-c`,
          `@orgname/theme-d`,
        ].map(name => {
          return {
            themeName: name,
            themeDir: xplatPath(`/some/node_modules/${name}`),
          }
        }),
      })
      const [theme, component] = plugin.getThemeAndComponent(
        xplatPath(requestPath)
      )
      expect(
        plugin.requestPathIsIssuerShadowPath({
          // issuer は `theme-b` の中にある
          issuerPath: xplatPath(issuerPath),
          // a-theme の中で自分が「シャドーの子」になっているファイルを require している
          theme,
          component,
          userSiteDir: xplatPath(userSiteDir),
        })
      ).toEqual(result)
    }
  )
})
