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

  return import(`web-vitals`).then(({ onLCP, onINP, onCLS }) => {
    const debouncedCLS = debounce(sendData, 3000)
    // INP は操作のたびに値が大きくなることがあるので、デバウンスする
    const debouncedINP = debounce(sendData, 3000)
    // LCP は複数回発生することがあるので、デバウンスする
    const debouncedLCP = debounce(sendData, 3000)

    // reportAllChanges を付けると、値が確定するのを待たずに、値が変わるたびに報告される。
    onCLS(debouncedCLS, { reportAllChanges: true })
    onINP(debouncedINP, { reportAllChanges: true })
    onLCP(debouncedLCP, { reportAllChanges: true })
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
