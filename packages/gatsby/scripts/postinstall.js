try {
  const { getLatestAPIs, getLatestAdapters } = require('../dist/utils/get-latest-gatsby-files')
  getLatestAPIs()
  getLatestAdapters()
} catch (e) {
  // おそらくブートストラップ中で、まだ公開されていない
}
