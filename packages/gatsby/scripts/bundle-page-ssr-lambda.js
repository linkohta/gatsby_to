// `.cache/page-ssr/lambda.js` は、SSR/DSG のサーバーレス関数のエントリーポイントである。
// アダプターはこれをそのまま配布するので、単体で動作する必要があり、
// `node_modules` から何も require できない。`gatsby build` のたびにではなく、
// パッケージのビルド時にここでバンドルするのは、中身にサイト固有のものが
// ないためである。わずかなサイト固有の値は `%PLACEHOLDER%` という文字列になっており、
// `utils/page-ssr-module/bundle-webpack.ts` がビルド時に置き換える。
const path = require(`path`)
const webpack = require(`webpack`)

const packageRoot = path.join(__dirname, `..`)

const compiler = webpack({
  name: `Page SSR Lambda`,
  mode: `none`,
  target: `node`,
  devtool: false,
  context: packageRoot,
  entry: path.join(packageRoot, `src`, `utils`, `page-ssr-module`, `lambda.ts`),
  output: {
    path: path.join(packageRoot, `dist`, `utils`, `page-ssr-module`),
    filename: `lambda.js`,
    libraryTarget: `commonjs`,
  },
  resolve: {
    extensions: [`.ts`, `.mjs`, `.js`, `.json`],
  },
  // `gatsby build` の実行時に `bundle-webpack.ts` がバンドルの隣へ書き出すので、
  // 実行時の require のままにしておく必要がある
  externals: [`./index`, `../query-engine`],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: require.resolve(`babel-loader`),
          options: { cwd: packageRoot },
        },
      },
      {
        test: /\.m?js$/,
        type: `javascript/auto`,
        resolve: {
          byDependency: {
            esm: {
              fullySpecified: false,
            },
          },
        },
      },
    ],
  },
})

const isWatch = process.argv.includes(`--watch`)

function onBuild(err, stats) {
  if (err) {
    console.error(err)
  } else if (stats?.hasErrors()) {
    console.error(stats.toString({ colors: true, all: false, errors: true }))
  } else {
    console.log(stats.toString({ colors: true, preset: `minimal` }))
    return
  }

  if (!isWatch) {
    process.exit(1)
  }
}

if (isWatch) {
  compiler.watch({}, onBuild)
} else {
  compiler.run((err, stats) => {
    compiler.close(closeErr => onBuild(err || closeErr, stats))
  })
}
