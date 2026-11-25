// 起動したプロセスは TS 対応のための jest の設定を使わないので、自前で対応を追加する必要がある
// @babel/register 8 は変換を worker スレッドで行う。worker も NODE_OPTIONS を引き継いで
// このファイルを読み込むので、メインスレッドでだけ登録する。そうしないと worker が際限なく作られる
if (require(`worker_threads`).isMainThread) {
  // @babel/register 8 は ESM 専用なので、require() では関数が default に入る
  require(`@babel/register`).default({
    extensions: [`.js`, `.ts`],
    configFile: require.resolve(`../../../../../babel.config.js`),
    ignore: [/node_modules/],
  })
}
