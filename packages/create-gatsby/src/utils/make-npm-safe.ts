// 文字列を、フォルダー名や npm パッケージ名として安全に使える形にする
export const makeNpmSafe = (str: string): string =>
  str
    // キャメルケースをケバブケースに置き換える
    .replace(/([a-z])([A-Z])/g, `$1-$2`)
    .toLowerCase()
    // 使えない文字が連続している部分を、いくつあっても 1 つのダッシュに置き換える
    .replace(/[^a-z0-9_.]+/g, `-`)
    // 末尾のドットとダッシュを取り除く
    .replace(/^[_\-.]+|[_\-.]+$/g, ``)
