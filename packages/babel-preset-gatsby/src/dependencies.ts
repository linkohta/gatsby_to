// このファイルは create-react-app の実装を大いに参考にしている
// @see https://github.com/facebook/create-react-app/blob/master/packages/babel-preset-react-app/dependencies.js

import * as path from "path"
import { loadCachedConfig } from "./index"
import { CORE_JS_POLYFILL_EXCLUDE_LIST as polyfillsToExclude } from "gatsby-legacy-polyfills/dist/exclude"

interface IPresetOptions {
  stage?: "build-javascript" | "build-html" | "develop" | "develop-html"
}

// require.resolve 経由で webpack に直接渡されるので、ここでは export default が
// 必要である
// この関数は、型を書くよりも推論に任せたほうがよい結果になり、内容も比較的理解しやすい。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default (_?: unknown, options: IPresetOptions = {}) => {
  const absoluteRuntimePath = path.dirname(
    require.resolve(`@babel/runtime/package.json`)
  )

  const stage = options.stage || `test`
  const pluginBabelConfig = loadCachedConfig()
  const targets = pluginBabelConfig.browserslist

  return {
    // Babel は ES Modules を前提にするが、CommonJS がなくなるまでは
    // 安全ではない。ここでは、ファイル内に `import` か `export` がない限り
    // CommonJS とみなすように挙動を変えている。
    // https://github.com/webpack/webpack/issues/4039#issuecomment-419284940
    sourceType: `unambiguous`,
    presets: [
      [
        // 最新の安定版の ECMAScript の機能
        require.resolve(`@babel/preset-env`),
        {
          // エントリーポイントで core-js を import できるようにし、browserslist を使ってポリフィルを選ぶ
          // V3 での変更。これを entry にする
          useBuiltIns: `usage`,
          corejs: 3,
          modules: false,
          // debug: true,
          targets,
          exclude: [
            // すべてのコードを遅くする変換を除外する (https://github.com/facebook/create-react-app/pull/5278)
            `transform-typeof-symbol`,
            ...polyfillsToExclude,
          ],
        },
      ],
    ],
    plugins: [
      // async/await、ジェネレーターなどに必要なランタイムのポリフィルを入れる
      // https://babeljs.io/docs/en/babel-plugin-transform-runtime
      [
        require.resolve(`@babel/plugin-transform-runtime`),
        {
          corejs: false,
          helpers: true,
          regenerator: true,
          // https://babeljs.io/docs/en/babel-plugin-transform-runtime#useesmodules
          // Node の LTS の最も古いバージョンが ES Modules に対応したら、
          // これを有効にすべきである。
          useESModules: true,
          // ランタイムをカプセル化し、正しいバージョンが確実に使われるようにする、
          // ドキュメントに載っていないオプション
          // https://github.com/babel/babel/blob/090c364a90fe73d36a30707fc612ce037bdbbb24/packages/babel-plugin-transform-runtime/src/index.js#L35-L42
          absoluteRuntime: absoluteRuntimePath,
        },
      ],
      // import() の構文に対応する
      require.resolve(`@babel/plugin-syntax-dynamic-import`),
      stage === `build-javascript` && [
        // 本番ビルドから PropTypes を削除する
        require.resolve(`babel-plugin-transform-react-remove-prop-types`),
        {
          removeImport: true,
        },
      ],
    ].filter(Boolean),
  }
}
