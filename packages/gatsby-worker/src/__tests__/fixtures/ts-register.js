// spawned process won't use jest config to support TS, so we need to add support ourselves
// @babel/register 8 は変換を worker スレッドで行う。worker も NODE_OPTIONS を引き継いで
// このファイルを読み込むので、メインスレッドでだけ登録する。そうしないと worker が際限なく作られる
if (require(`worker_threads`).isMainThread) {
  // @babel/register 8 は ESM 専用なので、require() では関数が default に入る
  require(`@babel/register`).default({
    extensions: [`.js`, `.ts`],
    configFile: require.resolve(`../../../.babelrc`),
    ignore: [/node_modules/],
  })
}
