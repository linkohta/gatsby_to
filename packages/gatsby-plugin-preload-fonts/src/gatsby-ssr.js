const React = require(`react`)
const { URL } = require(`url`)

const { load: loadCache } = require(`./prepare/cache`)

function getLinkProps({ crossOrigin, pathname }) {
  switch (typeof crossOrigin) {
    case `string`:
      return { crossOrigin }
    case `function`:
      return getLinkProps({ crossOrigin: crossOrigin(pathname), pathname })
    default:
      return { crossOrigin: `anonymous` }
  }
}

exports.onRenderBody = (
  { setHeadComponents, pathname = `/` },
  { crossOrigin = `anonymous` } = {}
) => {
  const cache = loadCache()
  // アセットをキャッシュから読み込もうとする。検索キーとして、末尾のスラッシュがあるルートとないルートの両方を考慮する
  const cacheEntry = cache.assets[pathname] || cache.assets[pathname + `/`]
  if (!cacheEntry) return

  const props = getLinkProps({ crossOrigin, pathname })

  const assets = Object.keys(cacheEntry)

  setHeadComponents(
    assets.map(href => {
      let assetProps

      // 外部の URL は、プラグインの設定から props を受け取る。
      // ローカルの URL には `crossOrigin: "anonymous"` が強制される
      try {
        // URL が外部のものかを確認する。そうでなければ、このコンストラクターは throw する。
        new URL(href)
        assetProps = props
      } catch (e) {
        assetProps = { crossOrigin: `anonymous` }
      }

      return (
        <link key={href} as="font" href={href} rel="preload" {...assetProps} />
      )
    })
  )
}
