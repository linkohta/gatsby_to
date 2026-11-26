import React from "react"
import picomatch from "picomatch"

// 除外パスの glob を、ブラウザーで評価する正規表現に変換する。
// minimatch 10 までの `makeRe()` と結果をそろえるために、次の 2 点を合わせている。
// - `strictSlashes`: `/blog/*` が `/blog/a/` に一致しないようにする
// - `/preview/**` のように `/**` で終わる glob は、`/preview` 自体にも一致させる
const globToRegExps = glob => {
  const options = { strictSlashes: true }
  const regExps = [picomatch.makeRe(glob, options)]
  if (glob.endsWith(`/**`) && glob.length > 3) {
    regExps.push(picomatch.makeRe(glob.slice(0, -3), options))
  }
  return regExps
}

exports.onRenderBody = (
  { setHeadComponents, setPostBodyComponents },
  pluginOptions
) => {
  if (process.env.NODE_ENV !== `production` && process.env.NODE_ENV !== `test`)
    return null

  const gtagConfig = pluginOptions.gtagConfig || {}
  const pluginConfig = pluginOptions.pluginConfig || {}

  const origin = pluginConfig.origin || `https://www.googletagmanager.com`

  // Lighthouse は google tag manager への preconnect を推奨している
  setHeadComponents([
    <link rel="preconnect" key="preconnect-google-gtag" href={origin} />,
    <link rel="dns-prefetch" key="dns-prefetch-google-gtag" href={origin} />,
  ])

  // ページの初回読み込み時に、`config` コマンドによって重複した、または除外対象の pageview イベントが送られるのを防ぐ
  // https://developers.google.com/analytics/devguides/collection/gtagjs/#disable_pageview_tracking

  gtagConfig.send_page_view = false

  const firstTrackingId =
    pluginOptions.trackingIds && pluginOptions.trackingIds.length
      ? pluginOptions.trackingIds[0]
      : ``

  const excludeGtagPaths = []
  if (typeof pluginConfig.exclude !== `undefined`) {
    pluginConfig.exclude.map(exclude => {
      excludeGtagPaths.push(...globToRegExps(exclude))
    })
  }

  const setComponents = pluginConfig.head
    ? setHeadComponents
    : setPostBodyComponents

  const renderHtml = () => `
      ${
        excludeGtagPaths.length
          ? `window.excludeGtagPaths=[${excludeGtagPaths.join(`,`)}];`
          : ``
      }
      ${
        typeof gtagConfig.anonymize_ip !== `undefined` &&
        gtagConfig.anonymize_ip === true
          ? `function gaOptout(){document.cookie=disableStr+'=true; expires=Thu, 31 Dec 2099 23:59:59 UTC;path=/',window[disableStr]=!0}var gaProperty='${firstTrackingId}',disableStr='ga-disable-'+gaProperty;document.cookie.indexOf(disableStr+'=true')>-1&&(window[disableStr]=!0);`
          : ``
      }
      if(${
        pluginConfig.respectDNT
          ? `!(navigator.doNotTrack == "1" || window.doNotTrack == "1")`
          : `true`
      }) {
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());

        ${pluginOptions.trackingIds
          .map(
            trackingId =>
              `gtag('config', '${trackingId}', ${JSON.stringify(gtagConfig)});`
          )
          .join(``)}
      }
      `

  return setComponents([
    <script
      key={`gatsby-plugin-google-gtag`}
      async
      src={`${origin}/gtag/js?id=${firstTrackingId}`}
    />,
    <script
      key={`gatsby-plugin-google-gtag-config`}
      dangerouslySetInnerHTML={{ __html: renderHtml() }}
    />,
  ])
}
