// このモジュールは、エンジンの中で最初、または最初のほうのモジュールとして import すべきである。
// エンジンを import する前に変数 `global._fsWrapper` を設定することで、
// 代わりの `fs` モジュールを渡せるようにする。代わりの `fs` が渡されなければ、
// 自動的に通常の `fs` にフォールバックする。

/* eslint-disable @typescript-eslint/no-namespace */

declare global {
  namespace NodeJS {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface Global {
      _fsWrapper: typeof import("fs")
      _actualFsWrapper: typeof import("fs")
    }
  }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __non_webpack_require__: typeof require

if (global._fsWrapper) {
  global._actualFsWrapper = global._fsWrapper
} else {
  // 代わりの fs が渡されなかったので、通常の fs にフォールバックする
  global._actualFsWrapper = __non_webpack_require__(`fs`)
}

// webpack のモジュールキャッシュにデータを入れる（グローバルを使うので、遅延はされない）
require(`fs`)

// https://stackoverflow.com/a/59499895
export {}
