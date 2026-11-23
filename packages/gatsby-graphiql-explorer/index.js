const fs = require(`fs`)
const path = require(`path`)

const distDirectory = path.join(__dirname, `dist`)

module.exports = (expressApp, { graphqlEndpoint, getFragments }) => {
  const assets = new Set(
    fs
      .readdirSync(distDirectory)
      .filter(file => file !== `app.js` && file !== `index.html`)
  )
  const bundleUrlHandler = path.posix.join(graphqlEndpoint, `app.js`)
  const fragmentsUrlHandler = path.posix.join(graphqlEndpoint, `fragments`)
  const assetsUrlHandler = path.posix.join(graphqlEndpoint, `:file`)

  expressApp.get(bundleUrlHandler, (_req, res) => {
    res.set(`Cache-Control`, `public, max-age=31557600`)
    res.sendFile(path.join(distDirectory, `app.js`))
  })

  // `app.js` が読み込むチャンク（Monaco エディターの worker など）を配信する。
  // `dist` にあるファイル名だけを受け付ける
  expressApp.get(assetsUrlHandler, (req, res, next) => {
    const { file } = req.params
    if (!assets.has(file)) {
      next()
      return
    }

    res.set(`Cache-Control`, `public, max-age=31557600`)
    res.sendFile(path.join(distDirectory, file))
  })

  expressApp.get(graphqlEndpoint, (_req, res) => {
    res.sendFile(path.join(distDirectory, `index.html`))
  })

  expressApp.get(fragmentsUrlHandler, (_req, res) => {
    res.json(getFragments())
  })
}
