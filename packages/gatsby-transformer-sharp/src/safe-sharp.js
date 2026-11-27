// "sharp" はこのプラグイン自身の依存から解決する必要があるので、読み込む処理だけをここに残している。
// 読み込みに失敗したときの案内は gatsby-core-utils/safe-sharp にまとめてある。
const { loadSharpSafely } = require(`gatsby-core-utils/safe-sharp`)

module.exports = loadSharpSafely(() => require(`sharp`))
