const listOfMetricsSend = new Set()

function debounce(fn, timeout) {
  let timer = null

  return function (...args) {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(fn, timeout, ...args)
  }
}

function sendWebVitals() {
  function sendData(data) {
    if (listOfMetricsSend.has(data.name)) {
      return
    }
    listOfMetricsSend.add(data.name)

    sendToGoogleAnalytics(data)
  }

  return import(`web-vitals/base`).then(({ getLCP, getFID, getCLS }) => {
    const debouncedCLS = debounce(sendData, 3000)
    // FID はデバウンスする必要がない。発生した時点で送信する
    const debouncedFID = sendData
    // LCP は複数回発生することがあるので、デバウンスする
    const debouncedLCP = debounce(sendData, 3000)

    // true フラグを付けると、リッスンの開始が遅れた場合に備えて、それ以前の発生分もすべて計測する。
    getCLS(debouncedCLS, true)
    getFID(debouncedFID, true)
    getLCP(debouncedLCP, true)
  })
}

function sendToGoogleAnalytics({ name, value, id }) {
  window.ga(`send`, `event`, {
    eventCategory: `Web Vitals`,
    eventAction: name,
    // `id` の値は、現在のページ読み込みに固有のものになる。同じページから
    // 複数の値を送る場合（CLS など）、Google Analytics はこの ID で
    // グループ化して合計を計算できる（注: レポートのディメンションに
    // `eventLabel` を含める必要がある）。
    eventLabel: id,
    // Google Analytics の指標は整数でなければならないので、値を丸めている。
    // CLS は精度を上げるため、先に値を 1000 倍している
    // （注: さらに精度が必要な場合は、倍率を上げること）。
    eventValue: Math.round(name === `CLS` ? value * 1000 : value),
    // 直帰率に影響しないよう、非インタラクションイベントを使う。
    nonInteraction: true,
    // ブラウザが対応していれば `sendBeacon()` を使う。
    transport: `beacon`,
  })
}

export const onRouteUpdate = ({ location }, pluginOptions = {}) => {
  const ga = window.ga
  if (process.env.NODE_ENV !== `production` || typeof ga !== `function`) {
    return null
  }

  const pathIsExcluded =
    location &&
    typeof window.excludeGAPaths !== `undefined` &&
    window.excludeGAPaths.some(rx => rx.test(location.pathname))

  if (pathIsExcluded) return null

  // react-helmet の変更が終わってから実行されるよう、timeout で包む (https://github.com/gatsbyjs/gatsby/issues/9139)
  // reactHelmet は requestAnimationFrame を使っている: https://github.com/nfl/react-helmet/blob/5.2.0/src/HelmetUtils.js#L296-L299
  const sendPageView = () => {
    const pagePath = location
      ? location.pathname + location.search + location.hash
      : undefined
    ga(`set`, `page`, pagePath)
    ga(`send`, `pageview`)
  }

  // reactHelmet の requestAnimationFrame に合わせた最小の遅延
  const delay = Math.max(32, pluginOptions.pageTransitionDelay || 0)
  setTimeout(sendPageView, delay)

  return null
}

export function onInitialClientRender(_, pluginOptions) {
  if (
    process.env.NODE_ENV === `production` &&
    typeof ga === `function` &&
    pluginOptions.enableWebVitalsTracking
  ) {
    sendWebVitals()
  }
}
