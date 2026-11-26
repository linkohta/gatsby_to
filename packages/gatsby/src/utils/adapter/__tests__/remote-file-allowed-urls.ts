import pathToRegexp from "path-to-regexp"

// `manager.ts` は `addRemoteFileAllowedUrl` で登録されたパターンを path-to-regexp で正規表現に変換し、
// `remoteFileAllowedUrls` の `regexSource` としてアダプターへ渡す。
// アダプターはこの正規表現をリクエストで指定された URL との照合に使うため、
// バックトラッキングが膨らむ正規表現が作られると ReDoS になる（GHSA-37ch-88jc-xwx2）。
// path-to-regexp が修正前のバージョンへ戻らないことを、ここで確認する。
describe(`regex source of remote file allowed urls`, () => {
  it(`keeps the output for patterns with a single wildcard`, () => {
    expect(pathToRegexp(`https://images.ctfassets.net/space-id/*`).source).toBe(
      String.raw`^https:\/\/images\.ctfassets\.net\/space-id\/(.*)\/?$`
    )
  })

  it(`does not create a backtracking-prone regex for three or more parameters in one segment`, () => {
    const source = pathToRegexp(`https://cdn.example.com/:a-:b-:c-:d`).source

    // 修正前は、後ろのパラメーターほど先読みが `--`、`---` と緩くなり、区切り文字を含む文字列に一致できた
    expect(source).toBe(
      String.raw`^https:\/\/cdn\.example\.com(?:\/([^/]+?))-(?:((?:(?!\/|-).)+?))-(?:((?:(?!\/|-).)+?))-(?:((?:(?!\/|-).)+?))\/?$`
    )
  })
})
