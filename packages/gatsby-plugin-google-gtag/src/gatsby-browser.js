exports.onRouteUpdate = ({ location }, pluginOptions = {}) => {
  if (process.env.NODE_ENV !== `production` || typeof gtag !== `function`) {
    return null
  }

  const pluginConfig = pluginOptions.pluginConfig || {}

  const pathIsExcluded =
    location &&
    typeof window.excludeGtagPaths !== `undefined` &&
    window.excludeGtagPaths.some(rx => rx.test(location.pathname))

  if (pathIsExcluded) return null

  // react-helmet の変更が終わってから実行されるよう、timeout で包む (https://github.com/gatsbyjs/gatsby/issues/11592)
  const sendPageView = () => {
    const pagePath = location
      ? location.pathname + location.search + location.hash
      : undefined
    window.gtag(`event`, `page_view`, { page_path: pagePath })
  }

  const { delayOnRouteUpdate = 0 } = pluginConfig

  if (`requestAnimationFrame` in window) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(sendPageView, delayOnRouteUpdate))
    })
  } else {
    // requestOnAnimationFrame の呼び出し 2 回分を再現するため、32ms 遅らせる
    setTimeout(sendPageView, 32 + delayOnRouteUpdate)
  }

  return null
}
