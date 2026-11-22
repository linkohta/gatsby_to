import { compile } from "coffeescript"
import resolve from "./resolve"

const COFFEE = /\.coffee$/

export function resolvableExtensions() {
  return [`.coffee`]
}

export function onCreateWebpackConfig({ loaders, actions }) {
  // ES6 の export の問題を回避するために Babel を使う必要がある。
  actions.setWebpackConfig({
    module: {
      rules: [
        {
          test: COFFEE,
          use: [loaders.js(), resolve(`coffee-loader`)],
        },
      ],
    },
  })
}

export function preprocessSource({ filename, contents }, pluginOptions) {
  if (COFFEE.test(filename)) {
    return compile(contents, pluginOptions)
  }
  return null
}
