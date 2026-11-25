// このファイルは create-react-app の実装を大いに参考にしている
// @see https://github.com/facebook/create-react-app/blob/master/packages/babel-preset-react-app/dependencies.js

import * as path from "path"
import { loadCachedConfig } from "./index"
import { CORE_JS_POLYFILL_EXCLUDE_LIST as polyfillsToExclude } from "gatsby-legacy-polyfills/dist/exclude"

interface IPresetOptions {
  stage?: `build-javascript` | `build-html` | `develop` | `develop-html`
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
          modules: false,
          // debug: true,
          targets,
          exclude: [
            // すべてのコードを遅くする変換を除外する (https://github.com/facebook/create-react-app/pull/5278)
            `transform-typeof-symbol`,
          ],
        },
      ],
    ],
    plugins: [
      [
        // Babel 8 の @babel/preset-env には useBuiltIns と corejs のオプションがなくなったので、
        // 使われている機能に応じた core-js のポリフィルは、このプラグインで読み込む
        require.resolve(`babel-plugin-polyfill-corejs3`),
        {
          method: `usage-global`,
          version: `3.0`,
          targets,
          exclude: polyfillsToExclude,
        },
      ],
      // async/await、ジェネレーターなどに必要なランタイムのヘルパーを import に置き換える
      // https://babeljs.io/docs/en/babel-plugin-transform-runtime
      [
        require.resolve(`@babel/plugin-transform-runtime`),
        {
          // babel-plugin-polyfill-corejs3 があると、ヘルパーの読み込み元の既定値が
          // @babel/runtime-corejs3 に変わる。これまでどおり @babel/runtime から読み込む
          moduleName: `@babel/runtime`,
          // ランタイムをカプセル化し、正しいバージョンが確実に使われるようにする
          absoluteRuntime: absoluteRuntimePath,
        },
      ],
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
