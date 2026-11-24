/* eslint-disable @babel/no-invalid-this */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { slash } from "gatsby-core-utils/path"
import path from "path"

// このモジュールは require する必要がある。ここでは import を使えない
const { createRequire } = require(`module`)

// これは、エンジン向けに lmdb（2 系と 3 系）を webpack でバンドルできるように、
// 文字列の置換を行う、その場しのぎの webpack ローダーである。
// 現状では、`@vercel/webpack-asset-relocator-loader は、lmdb による
// バイナリと辞書ファイルの読み込み方を扱えない
// （静的に解析できない）。そのため、いくつかの局所的な変更を行い、
// 動的な値をハードコードした値に置き換えて、asset-relocator が
// それらのアセットを拾って処理できるようにする。
//
// lmdb のコードは変わりうるので、gatsby の依存でもバージョンを固定しており、
// 手動で（おそらく renovate で）上げる必要がある。
//
// これを lmdb 本体の側で解決するには、いくつかの点を変更する必要がある。
//  - https://github.com/DoctorEvidence/lmdb-js/blob/544b3fda402f24a70a0e946921e4c9134c5adf85/node-index.js#L14-L16
//  - https://github.com/DoctorEvidence/lmdb-js/blob/544b3fda402f24a70a0e946921e4c9134c5adf85/open.js#L77
// 現状で問題を起こしているのは、`import.meta.url` への依存と `.replace` の使用のようである。

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function (this: any, source: string): string {
  let lmdbBinaryLocation: string | undefined

  try {
    const lmdbRoot =
      this?._module.resourceResolveData?.descriptionFileRoot ||
      path.dirname(this.resourcePath).replace(`/dist`, ``)

    const lmdbRequire = createRequire(this.resourcePath)
    const forcedBinaryModule = this.getOptions()?.forcedBinaryModule
    let absoluteModulePath
    if (forcedBinaryModule) {
      try {
        absoluteModulePath = lmdbRequire.resolve(forcedBinaryModule)
      } catch (e) {
        // no-op
      }
    }

    if (!absoluteModulePath) {
      let nodeGypBuild
      try {
        nodeGypBuild = lmdbRequire(`node-gyp-build-optional-packages`)
      } catch (e) {
        // lmdb@2.3.8 の方法でのバイナリの読み込みに失敗したので、完全に失敗とする前に、
        // 古い方法へのフォールバックを試みる
      }

      if (!nodeGypBuild) {
        // lmdb@2.3.8 が、期待する node-gyp-build のフォーク（node-gyp-build-optional-packages）を import していなかった場合は、
        // フォーク元のパッケージへのフォールバックを試みる。それも動かなければ、コンパイルを失敗させる
        nodeGypBuild = lmdbRequire(`node-gyp-build`)
      }
      absoluteModulePath = nodeGypBuild.path(lmdbRoot)
    }

    lmdbBinaryLocation = slash(
      path.relative(path.dirname(this.resourcePath), absoluteModulePath)
    )
  } catch (e) {
    return source
  }

  if (!lmdbBinaryLocation) {
    return source
  }

  return source
    .replace(
      `require$1('node-gyp-build-optional-packages')(dirName)`,
      `require(${JSON.stringify(lmdbBinaryLocation)})`
    )
    .replace(
      `require$1('node-gyp-build')(dirName)`,
      `require(${JSON.stringify(lmdbBinaryLocation)})`
    )
    .replace(
      `loadNAPI__default["default"](dirName);`,
      `require(${JSON.stringify(lmdbBinaryLocation)})`
    )
    .replace(
      `require$2.resolve('./dict/dict.txt')`,
      `require.resolve('../dict/dict.txt')`
    )
    .replace(
      /fs\.readFileSync\(\s*new URL\(\s*'\.\/dict\/dict\.txt',\s*\(typeof\s*document\s*===\s*'undefined'\s*\?\s*new\s*\(require\('u'\s*\+\s*'rl'\)\.URL\)\s*\('file:'\s*\+\s*__filename\).href\s*:\s*\(document\.currentScript\s*&&\s*(?:document\.currentScript\.tagName\.toUpperCase\(\)\s*===\s*'SCRIPT'\s*&&\s*)?document\.currentScript\.src\s*\|\|\s*new URL\('index\.cjs',\s*document\.baseURI\)\.href\)\)\.replace\(\/dist\[\\\\\\\/\]index\.cjs\$\/,\s*''\),?\s*\),?\s*\)/g,
      `fs.readFileSync(require.resolve('../dict/dict.txt'))`
    )
}
