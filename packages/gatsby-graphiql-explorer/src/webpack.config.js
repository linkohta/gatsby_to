const path = require(`path`)
const HtmlWebpackPlugin = require(`html-webpack-plugin`)
const webpack = require(`webpack`)

const mode = `production`

/** @type { import('webpack').Configuration } */
module.exports = {
  entry: path.join(__dirname, `app.jsx`),
  mode,
  output: {
    path: path.join(__dirname, `..`, `dist`),
    filename: `app.js`,
    // Monaco エディターの worker などは別のチャンクになる。チャンクは長期間
    // キャッシュされるので、ファイル名に内容のハッシュを入れる
    chunkFilename: `[name].[contenthash].js`,
    assetModuleFilename: `[name].[contenthash][ext]`,
    publicPath: `/___graphql/`,
  },
  devtool: false,
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: `babel-loader`,
          options: {
            presets: [
              [
                `@babel/preset-env`,
                {
                  // graphiql 6 は ESM 専用で、`exports` に `import` の条件しかない。
                  // CommonJS に変換すると解決できなくなるので、変換は webpack に任せる
                  modules: false,
                  targets: [
                    `>0.25% and supports es6-module`,
                    `not dead and supports es6-module`,
                  ],
                },
              ],
              [
                `@babel/preset-react`,
                {
                  // Babel 8 は既定が automatic になった。出力を変えないために classic を指定する
                  runtime: `classic`,
                  pragma: `React.createElement`,
                  development: mode !== `production`,
                },
              ],
            ],
            // Babel 8 では preset-env の `loose` がなくなったので、同じ出力になる
            // assumptions を個別に指定する
            assumptions: {
              arrayLikeIsIterable: true,
              constantReexports: true,
              enumerableModuleMeta: true,
              ignoreFunctionLength: true,
              ignoreToPrimitiveHint: true,
              mutableTemplateObject: true,
              noClassCalls: true,
              objectRestNoSymbols: true,
              privateFieldsAsProperties: true,
              pureGetters: true,
              setClassMethods: true,
              setComputedProperties: true,
              setPublicClassFields: true,
              setSpreadProperties: true,
              skipForOfIteratorClosing: true,
              superIsCallableConstructor: true,
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: [{ loader: `style-loader` }, { loader: `css-loader` }],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, `index.html.ejs`),
      filename: `index.html`,
      inject: false,
    }),
    new webpack.DefinePlugin({
      "process.env.NODE_ENV": JSON.stringify(mode),
    }),
  ],
  stats: {
    warnings: false,
  },
}
