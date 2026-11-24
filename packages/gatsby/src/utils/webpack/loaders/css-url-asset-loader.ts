import type { LoaderDefinitionFunction } from "webpack"

const ES_MODULE_DEFAULT_EXPORT = /^export default /

/**
 * CSS の `url()` から参照されたファイルに対して、url-loader や file-loader の後に実行するローダー。
 *
 * css-loader 6 以降は、`url()` を `require()` ではなく `new URL()` として出力する。webpack は
 * `new URL()` の参照先のモジュールが export した値をそのまま URL として使うので、url-loader や
 * file-loader が出力する ES モジュール（`export default "..."`）では、URL が `[object Module]` に
 * なってしまう。そこで、`module.exports = "..."` の形に書き換える。
 */
const cssUrlAssetLoader: LoaderDefinitionFunction = function (source) {
  if (typeof source !== `string`) {
    return source
  }

  return source.replace(ES_MODULE_DEFAULT_EXPORT, `module.exports = `)
}

export default cssUrlAssetLoader
