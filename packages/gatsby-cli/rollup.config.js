import resolve from "@rollup/plugin-node-resolve"
import babel from "@rollup/plugin-babel"
import commonjs from "@rollup/plugin-commonjs"
import json from "@rollup/plugin-json"
import replace from "@rollup/plugin-replace";
import autoExternal from "rollup-plugin-auto-external"
import internal from "rollup-plugin-internal"

import path from "path"

// Rollup は Ink による react-devtools-core の動的 require を巻き上げるため、
// window が見つからないというエラーになる。今のところ Ink の devtools ファイルを除外している。
function excludeDevTools() {
  const re = /ink/
  return {
    name: `ignoreDevTools`,

    load(id) {
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
            "targets": { "node": "18.0.0" }
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
    `../../redux`
  ]
}
