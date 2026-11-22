// 起動したプロセスは TS 対応のための jest の設定を使わないので、自前で対応を追加する必要がある
require(`@babel/register`)({
  extensions: [`.js`, `.ts`],
  configFile: require.resolve(`../../../../../babel.config.js`),
  ignore: [/node_modules/],
})
