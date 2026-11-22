import Module from "module"

/**
 * @deprecated 代わりに Node 組み込みの `module` の `createRequire` を使うこと。これは
 * Node < 10.12 向けのポリフィルだったが、サポート対象の最低バージョンよりはるかに
 * 古く、今は単なるエイリアスである。次のメジャーバージョンで削除する。
 */
export const createRequireFromPath = Module.createRequire
