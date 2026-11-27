// "sharp" はこのプラグイン自身の依存から解決する必要があるので、読み込む処理だけをここに残している。
// 読み込みに失敗したときの案内は gatsby-core-utils/safe-sharp にまとめてある。
const { loadSharpSafely } = require(`gatsby-core-utils/safe-sharp`)

module.exports = loadSharpSafely(() => {
  try {
    return require(`gatsby/sharp`)
  } catch (e) {
    return () => {
      const sharp = require(`sharp`)
      sharp.simd()
      sharp.concurrency(1)

      return Promise.resolve(sharp)
    }
  }
})
