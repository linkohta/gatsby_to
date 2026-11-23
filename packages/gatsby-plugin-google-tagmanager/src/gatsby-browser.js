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

function sendWebVitals(dataLayerName = `dataLayer`) {
  const win = window

  function sendData(data) {
    if (listOfMetricsSend.has(data.name)) {
      return
    }
    listOfMetricsSend.add(data.name)

    sendToGTM(data, win[dataLayerName])
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

function sendToGTM({ name, value, id }, dataLayer) {
  dataLayer.push({
    event: `core-web-vitals`,
    webVitalsMeasurement: {
      name: name,
      // `id` の値は、現在のページ読み込みに固有のものになる。同じページから
      // 複数の値を送る場合（CLS など）、Google Analytics はこの ID で
      // グループ化して合計を計算できる（注: レポートのディメンションに
      // `eventLabel` を含める必要がある）。
      id,
      // Google Analytics の指標は整数でなければならないので、値を丸めている。
      // CLS は精度を上げるため、先に値を 1000 倍している
      // （注: さらに精度が必要な場合は、倍率を上げること）。
      value: Math.round(name === `CLS` ? value * 1000 : value),
    },
  })
}

export function onRouteUpdate(_, pluginOptions) {
  if (
    process.env.NODE_ENV === `production` ||
    pluginOptions.includeInDevelopment
  ) {
    // タイトルが確実に変更されてから実行されるよう、timeout で包む
    setTimeout(() => {
      const data = pluginOptions.dataLayerName
        ? window[pluginOptions.dataLayerName]
        : window.dataLayer
      const eventName = pluginOptions.routeChangeEventName
        ? pluginOptions.routeChangeEventName
        : `gatsby-route-change`

      data.push({ event: eventName })
    }, 50)
  }
}

export function onInitialClientRender(_, pluginOptions) {
  // polyfill は本番でしか読み込まないので、開発時には有効にできない
  if (
    process.env.NODE_ENV === `production` &&
    pluginOptions.enableWebVitalsTracking
  ) {
    sendWebVitals(pluginOptions.dataLayerName)
  }
}
