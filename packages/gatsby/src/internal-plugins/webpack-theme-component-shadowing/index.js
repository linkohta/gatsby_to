const path = require(`path`)
const debug = require(`debug`)(`gatsby:component-shadowing`)
const fs = require(`fs`)
const _ = require(`lodash`)
const { splitComponentPath } = require(`gatsby-core-utils`)

// ファイルは、同じ拡張子のファイル、または「互換性のある」拡張子のファイルで
// シャドーイングできる。2 つの拡張子は、同じ「カテゴリー」に属していれば
// 互換性がある。たとえば .JS ファイル（コード）は、.TS ファイルや .JSX ファイル
// （どちらもコード）でシャドーイングできるが、.CSS ファイル（スタイルシート）や
// .PNG ファイル（画像）ではできない。次の一覧は、それぞれの拡張子がどのカテゴリーに
// 属するかを定めている。なお、この一覧にないファイルは、同じ拡張子のファイルでしか
// シャドーイングできない。

// FIXME: ユーザーやプラグインがこの一覧を拡張できるようにする方法を決める
const DEFAULT_FILE_EXTENSIONS_CATEGORIES = {
  // コードの形式
  js: `code`,
  jsx: `code`,
  ts: `code`,
  tsx: `code`,
  cjs: `code`,
  mjs: `code`,
  mts: `code`,
  coffee: `code`,

  // JSON に似たデータ形式
  json: `json`,
  yaml: `json`,
  yml: `json`,

  // スタイルシートの形式
  css: `stylesheet`,
  sass: `stylesheet`,
  scss: `stylesheet`,
  less: `stylesheet`,
  "css.js": `stylesheet`,

  // 画像の形式
  jpeg: `image`,
  jpg: `image`,
  jfif: `image`,
  png: `image`,
  tiff: `image`,
  webp: `image`,
  avif: `image`,
  gif: `image`,

  // フォント
  woff: `font`,
  woff2: `font`,
}

// TO-DO:
//  - ファイルの作成や削除に合わせて、シャドーイングされたモジュールを webpack のチェーンに追加または削除できるようにする
//    ( https://github.com/gatsbyjs/gatsby/issues/11456 ):
//    - そのためには、ページテンプレートのシャドーイングに対するメモの無効化も追加する必要がある:
//      `createPage` アクションクリエイターで使われている、メモ化された `shadowCreatePagePath` 関数を参照。

module.exports = class GatsbyThemeComponentShadowingResolverPlugin {
  constructor({ projectRoot, themes, extensions, extensionsCategory }) {
    debug(
      `themes list`,
      themes.map(({ themeName }) => themeName)
    )
    this.themes = themes
    this.projectRoot = projectRoot

    this.extensions = extensions ?? []
    this.extensionsCategory = {
      ...DEFAULT_FILE_EXTENSIONS_CATEGORIES,
      ...extensionsCategory,
    }
    this.additionalShadowExtensions = this.buildAdditionalShadowExtensions()
  }

  buildAdditionalShadowExtensions() {
    const extensionsByCategory = _.groupBy(
      this.extensions,
      ext => this.extensionsCategory[ext.substring(1)] || `undefined`
    )

    const additionalExtensions = []
    for (const [category, exts] of Object.entries(extensionsByCategory)) {
      if (category === `undefined`) continue
      for (const ext of exts) {
        additionalExtensions.push({ key: ext, value: exts })
      }
    }

    // ".css.js" のようなものが ".js" より先に拾われるように、
    // 拡張子を長い順に並べ替える
    return additionalExtensions.sort(
      ({ key: a }, { key: b }) => a.length <= b.length
    )
  }

  apply(resolver) {
    // このフックは非常に早い段階で実行され、元のファイル名を記録する
    resolver
      .getHook(`resolve`)
      .tapAsync(
        `GatsbyThemeComponentShadowingResolverPlugin`,
        (request, stack, callback) => {
          if (!request._gatsbyThemeShadowingOriginalRequestPath) {
            request._gatsbyThemeShadowingOriginalRequestPath = request.request
          }
          return callback()
        }
      )

    // ここが実際の処理の核心である
    resolver
      .getHook(`before-resolved`)
      .tapAsync(
        `GatsbyThemeComponentShadowingResolverPlugin`,
        (request, stack, callback) => {
          const [theme, component] = this.getThemeAndComponent(request.path)
          if (!theme) {
            return callback()
          }

          if (
            /**
             * 誰かが
             * ```
             * modules: [path.resolve(__dirname, /src'), 'node_modules'],
             * ```
             * を webpack の設定に追加すると、`issuer` は `null` になるので、この確認をスキップする。
             * なお、テーマの中で `modules` をこのように設定するのは、一般的には
             * おそらく良くない。しかし、そうしている人の環境をこちらの都合で
             * 壊すべきでもない。
             */
            request.context.issuer &&
            /**
             * issuer は、require のリクエストを出しているファイルである。ユーザーの
             * サイトの中にあることも、テーマの中にあることもある。issuer が、自分も
             * 属しているシャドーチェーンの中のパスをリクエストしている場合は、
             * リクエストを通常どおり通す。そうでない場合は、
             * シャドーイングのアルゴリズムを適用する。
             */
            this.requestPathIsIssuerShadowPath({
              component,
              theme,
              issuerPath: request.context.issuer,
              userSiteDir: this.projectRoot,
            })
          ) {
            return callback()
          }

          const originalRequestPath =
            request._gatsbyThemeShadowingOriginalRequestPath
          const originalRequestComponent = path.basename(originalRequestPath)

          // ここからがシャドーイングのアルゴリズムである。
          const builtComponentPath = this.resolveComponentPath({
            theme,
            component,
            originalRequestComponent,
          })

          if (builtComponentPath) {
            return resolver.doResolve(
              resolver.hooks.describedRelative,
              { ...request, path: builtComponentPath },
              null,
              {},
              callback
            )
          } else {
            return callback()
          }
        }
      )
  }

  // ユーザーのプロジェクトとテーマのファイルを確認する
  resolveComponentPath({
    theme,
    component: originalComponent,
    originalRequestComponent,
  }) {
    const [component, content] = splitComponentPath(originalComponent)

    // 一致したテーマ自身は、シャドーイングの候補のパスに含めない
    const themes = this.themes.filter(
      ({ themeName }) => themeName !== theme.themeName
    )

    const themesArray = [
      path.join(this.projectRoot, `src`, theme.themeName),
    ].concat(
      themes
        .reverse()
        .map(({ themeDir }) => path.join(themeDir, `src`, theme.themeName))
    )

    const acceptableShadowFileNames = this.getAcceptableShadowFileNames(
      path.basename(component),
      originalRequestComponent
    )

    for (const theme of themesArray) {
      const possibleComponentPath = path.join(theme, component)
      debug(`possibleComponentPath`, possibleComponentPath)

      let dir
      try {
        // TypeScript やその他の構文でも動くように、require.resolve ではなく
        // fs/path を使う
        dir = fs.readdirSync(path.dirname(possibleComponentPath))
      } catch (e) {
        continue
      }
      const existsDir = dir.map(filepath => path.basename(filepath))

      // 完全に一致するパスがなければ、拡張子を探す
      const matchingShadowFile = acceptableShadowFileNames.find(shadowFile =>
        existsDir.includes(shadowFile)
      )
      if (matchingShadowFile) {
        const shadowPath = path.join(
          path.dirname(possibleComponentPath),
          matchingShadowFile
        )

        if (content) {
          return `${shadowPath}?__contentFilePath=${content}`
        }

        return shadowPath
      }
    }
    return null
  }

  getThemeAndComponent(filepath) {
    // どのテーマの src/components ディレクトリから require しているかを調べる
    const allMatchingThemes = this.themes.filter(({ themeDir }) =>
      filepath.startsWith(path.join(themeDir, `src`))
    )

    // 同じテーマがテーマの一覧に 2 回含まれて、複数回一致することがある。
    // その場合は、そのテーマについて 1 回の一致として数える。
    const matchingThemes = _.uniqBy(allMatchingThemes, `themeName`)

    // 一致するテーマが 0 個になるのは、扱いたくないパスでよく起きる
    // 一致するテーマが 2 個以上になるのは、次のようなパスの場合である
    //   `gatsby-theme-blog/src/components/gatsby-theme-something/src/components`
    if (matchingThemes.length > 1) {
      throw new Error(
        `Gatsby can't differentiate between themes ${matchingThemes
          .map(theme => theme.themeName)
          .join(` and `)} for path ${filepath}`
      )
    }

    if (matchingThemes.length === 0) {
      return [null, null]
    }

    const theme = matchingThemes[0]

    // テーマの src/ から見たコンポーネントの相対的な場所を取得する
    const [, component] = filepath.split(path.join(theme.themeDir, `src`))

    return [theme, component]
  }

  // テーマ名を受け取り、シャドーイングの候補になる場所をすべて返す
  getBaseShadowDirsForThemes(theme) {
    return Array.from(this.themes)
      .reverse()
      .map(({ themeName, themeDir }) => {
        if (themeName === theme) {
          return path.join(themeDir, `src`)
        } else {
          return path.join(themeDir, `src`, theme)
        }
      })
  }

  requestPathIsIssuerShadowPath({ theme, component, issuerPath, userSiteDir }) {
    if (!theme || !component) {
      return false
    }

    // シャドーイングの候補になる場所の一覧を取得する
    const shadowFiles = this.getBaseShadowDirsForThemes(theme.themeName)
      .concat(path.join(userSiteDir, `src`, theme.themeName))
      .map(dir => path.join(dir, component))
      .flatMap(comp => this.getAcceptableShadowFileNames(comp))

    // issuer が、自分自身のシャドーイングの候補になるパスをリクエストしている場合
    return shadowFiles.includes(issuerPath)
  }

  getAcceptableShadowFileNames(componentName, originalRequestComponent) {
    const matchingEntry = this.additionalShadowExtensions.find(entry =>
      componentName.endsWith(entry.key)
    )

    let additionalNames = []
    if (matchingEntry) {
      const baseName = componentName.slice(0, -matchingEntry.key.length)
      additionalNames = matchingEntry.value.map(ext => `${baseName}${ext}`)
    }

    let legacyAdditionalNames = []
    if (originalRequestComponent) {
      legacyAdditionalNames = this.extensions.map(
        ext => `${originalRequestComponent}${ext}`
      )
    }

    return _.uniq([componentName, ...additionalNames, ...legacyAdditionalNames])
  }
}
