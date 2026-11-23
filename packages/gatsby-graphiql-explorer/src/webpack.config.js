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
                  corejs: 3,
                  loose: true,
                  bugfixes: true,
                  // graphiql 6 は ESM 専用で、`exports` に `import` の条件しかない。
                  // CommonJS に変換すると解決できなくなるので、変換は webpack に任せる
                  modules: false,
                  useBuiltIns: `entry`,
                  targets: [
                    `>0.25% and supports es6-module`,
                    `not dead and supports es6-module`,
                  ],
                },
              ],
              [
                `@babel/preset-react`,
                {
                  useBuiltIns: true,
                  pragma: `React.createElement`,
                  development: mode !== `production`,
                },
              ],
            ],
            plugins: [
              [
                `@babel/plugin-proposal-class-properties`,
                {
                  loose: true,
                },
              ],
            ],
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
