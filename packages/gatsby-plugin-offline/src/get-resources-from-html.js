const cheerio = require(`cheerio`)
const path = require(`path`)
const fs = require(`fs`)
const _ = require(`lodash`)

module.exports = (htmlPath, pathPrefix) => {
  // オフラインで正しくリロードするために必要な script と link を取り出すため、index.html を読み込む
  let html
  try {
    // オフラインで正しくリロードするために必要な script と link を取り出すため、index.html を読み込む
    html = fs.readFileSync(path.resolve(htmlPath))
  } catch (err) {
    // ENOENT はファイルが存在しないことを意味する。ユーザーがカスタムの 404 ページを
    // 作成していない場合、404.html を開こうとするとこうなるのは想定どおりなので、
    // 空の配列を返す。
    if (err.code === `ENOENT`) {
      return []
    } else {
      throw err
    }
  }

  // 2006 年のようなやり方でいく
  const $ = cheerio.load(html)

  // script と link のパスを保持する
  const criticalFilePaths = []

  $(`
    script[src],
    link[as=script],
    link[as=font],
    link[as=fetch],
    link[rel=stylesheet],
    style[data-href]
  `).each((_, elem) => {
    const $elem = $(elem)
    const url =
      $elem.attr(`src`) || $elem.attr(`href`) || $elem.attr(`data-href`)

    // XML ファイルと外部リソース（// または http で始まるもの）はキャッシュしない
    const blackListRegex = /(\.xml$|^\/\/|^http)/

    // ヘッダーのタグから得たリソースの URL が、正しいプレフィックスで始まることを確認する
    // （これらはページの URL ではない）
    if (url && !blackListRegex.test(url) && url.startsWith(`${pathPrefix}/`)) {
      criticalFilePaths.push(url.replace(/^\//, ``))
    }
  })

  // Workbox がファイルを見つけられるよう、カスタムのプレフィックスを（あれば）取り除く。
  // 正しい場所から配信するため、実行時に付け直される
  // （gatsby-node.js の modifyUrlPrefix を参照）。
  return _.uniq(criticalFilePaths).map(url => url.slice(pathPrefix.length))
}
