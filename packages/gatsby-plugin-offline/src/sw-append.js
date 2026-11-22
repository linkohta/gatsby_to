/* global importScripts, workbox, idbKeyval */
importScripts(`%idbKeyValVersioned%`)

const { NavigationRoute } = workbox.routing

let lastNavigationRequest = null
let offlineShellEnabled = true

// より多くのブラウザに対応するため、標準的なオブジェクトの構文を使う
const MessageAPI = {
  setPathResources: (event, { path, resources }) => {
    event.waitUntil(idbKeyval.set(`resources:${path}`, resources))
  },

  clearPathResources: event => {
    event.waitUntil(idbKeyval.clear())

    // コンパイルハッシュの不一致を検出した
    // データファイルが同期していない可能性があるので、
    // ランタイムキャッシュを消去して、
    // あらためて fetch する必要がある
    event.waitUntil(
      caches.keys().then(function (keyList) {
        return Promise.all(
          keyList.map(function (key) {
            if (key && key.includes(`runtime`)) {
              return caches.delete(key)
            }

            return Promise.resolve()
          })
        )
      })
    )
  },

  enableOfflineShell: () => {
    offlineShellEnabled = true
  },

  disableOfflineShell: () => {
    offlineShellEnabled = false
  },
}

self.addEventListener(`message`, event => {
  const { gatsbyApi: api } = event.data
  if (api) MessageAPI[api](event, event.data)
})

function handleAPIRequest({ event }) {
  const { pathname } = new URL(event.request.url)

  const params = pathname.match(/:(.+)/)[1]
  const data = {}

  if (params.includes(`=`)) {
    params.split(`&`).forEach(param => {
      const [key, val] = param.split(`=`)
      data[key] = val
    })
  } else {
    data.api = params
  }

  if (MessageAPI[data.api] !== undefined) {
    MessageAPI[data.api]()
  }

  if (!data.redirect) {
    return new Response()
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: lastNavigationRequest,
    },
  })
}

const navigationRoute = new NavigationRoute(async ({ event }) => {
  // API リクエストは通常のナビゲーションリクエストとは別に扱うので、
  // この確認を先に行う
  if (event.request.url.match(/\/.gatsby-plugin-offline:.+/)) {
    return handleAPIRequest({ event })
  }

  if (!offlineShellEnabled) {
    return await fetch(event.request)
  }

  lastNavigationRequest = event.request.url

  let { pathname } = new URL(event.request.url)
  pathname = pathname.replace(new RegExp(`^%pathPrefix%`), ``)

  // リソースと app バンドルを確認する
  // 後者は、SW が新しいバージョンへ更新中の場合には存在しないことがある
  const resources = await idbKeyval.get(`resources:${pathname}`)
  if (!resources || !(await caches.match(`%pathPrefix%/%appFile%`))) {
    return await fetch(event.request)
  }

  for (const resource of resources) {
    // リソースの失敗を検出したら、すぐにページ全体をネットワークから
    // 取得する。こうすれば、ページの一部だけが失敗して
    // 不整合な状態になるおそれがない。
    if (!(await caches.match(resource))) {
      return await fetch(event.request)
    }
  }

  const offlineShell = `%pathPrefix%/offline-plugin-app-shell-fallback/index.html`
  const offlineShellWithKey = workbox.precaching.getCacheKeyForURL(offlineShell)
  return await caches.match(offlineShellWithKey)
})

workbox.routing.registerRoute(navigationRoute)

// このルートは、ナビゲーション以外のリクエスト（fetch など）を行うときに使われる
workbox.routing.registerRoute(/\/.gatsby-plugin-offline:.+/, handleAPIRequest)
