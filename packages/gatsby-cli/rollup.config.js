import resolve from "@rollup/plugin-node-resolve"
import babel from "@rollup/plugin-babel"
import commonjs from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import replace from "@rollup/plugin-replace";
import autoExternal from "rollup-plugin-auto-external"
import internalModule from "rollup-plugin-internal"

import path from "path"

// rollup-plugin-internal は TypeScript が出力した CommonJS（exports.default）なので、
// Rollup 4 が設定ファイルを読み込むときは、default import がモジュール全体になる
const internal = internalModule.default ?? internalModule

// Rollup は Ink による react-devtools-core の動的 require を巻き上げるため、
// window が見つからないというエラーになる。今のところ Ink の devtools ファイルを除外している。
function excludeDevTools() {
  const re = /ink/
  return {
    name: `ignoreDevTools`,

    load(id) {
      // \0 で始まる ID は、@rollup/plugin-commonjs などが内部で作る仮想モジュールである。
      // これを空にするとプラグインが必要とする export がなくなるので、実際のファイルだけを対象にする
      if (id.startsWith(`\0`)) {
        return null
      }

      if (id.match(re)) {
        if (path.parse(id).name === `devtools`) {
          return { code: `` }
        }
      }
    },
  }
}

const extensions = [`.mjs`, `.js`, `.json`, `.node`, `.ts`, `.tsx`]

export default {
  input: `src/reporter/loggers/ink/index.tsx`,
  output: {
    file: `lib/reporter/loggers/ink/index.js`,
    format: `cjs`,
  },
  cache: false,
  plugins: [
    replace({
      values: {
        "process.env.NODE_ENV": JSON.stringify(`production`)
      }
    }),
    excludeDevTools(),
    json(),
    babel({
      extensions,
      babelHelpers: `bundled`,
      skipPreflightCheck: true,
      exclude: `node_modules/**`,
      babelrc: false,
      presets: [
        [
          "@babel/env",
          {
            "modules": false,
            "shippedProposals": true,
            "targets": { "node": "22.0.0" }
          }
        ],
        "@babel/preset-react"
      ],
      plugins: ["@babel/plugin-transform-runtime", "@sigmacomputing/babel-plugin-lodash"],
      overrides: [
        {
          "test": ["**/*.ts", "**/*.tsx"],
          "plugins": [["@babel/plugin-transform-typescript", { "isTSX": true }]]
        }
      ]
    }),
    resolve({
      extensions,
      dedupe: [ `react`, `ink` ]
    }),
    commonjs(),
    autoExternal(),
    internal([
      `react`,
      `ink`,
      `ink-spinner`
    ]),
  ],
  external: [
    `yoga-layout-prebuilt`,
    // 次の項目には説明が必要である: ... これは、ink のロガーが getStore と onLogAction を
    // 上の階層（../../redux）から import しているためである。バンドルされたものと
    // そうでないものの 2 つができるのは避けたい。ストアのコピーが
    // 複数できてしまうからである
    `../../redux`,
    // gatsby-core-utils は dependencies にあるので autoExternal がバンドルの対象から外すが、
    // 対象になるのはパッケージ名そのものだけである。サブパスの import は、
    // @rollup/plugin-node-resolve が package.json の exports から解決してバンドルに含めてしまうので、
    // ここで明示的に外す
    `gatsby-core-utils/parse-component-path`
  ]
}
