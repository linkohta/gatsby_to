import { apiRunner } from "./api-runner-browser"

if (
  window.location.protocol !== `https:` &&
  window.location.hostname !== `localhost`
) {
  console.error(
    `Service workers can only be used over HTTPS, or on localhost for development`
  )
} else if (`serviceWorker` in navigator) {
  navigator.serviceWorker
    .register(`${__BASE_PATH__}/sw.js`)
    .then(function (reg) {
      reg.addEventListener(`updatefound`, () => {
        apiRunner(`onServiceWorkerUpdateFound`, { serviceWorker: reg })
        // updatefound イベントは reg.installing が設定されていることを意味する。次を参照
        // https://w3c.github.io/ServiceWorker/#service-worker-registration-updatefound-event
        const installingWorker = reg.installing
        console.log(`installingWorker`, installingWorker)
        installingWorker.addEventListener(`statechange`, () => {
          switch (installingWorker.state) {
            case `installed`:
              if (navigator.serviceWorker.controller) {
                // この時点で、古いコンテンツは消去され、新しいコンテンツが
                // キャッシュに追加されている。

                // 次回のナビゲーション時にページを再読み込みすべきことを Gatsby Link が分かるよう、フラグを設定する
                window.___swUpdated = true
                // ユーザーが更新のプロンプトを表示できるよう、onServiceWorkerUpdateReady API を呼ぶ。
                apiRunner(`onServiceWorkerUpdateReady`, { serviceWorker: reg })

                // 現在のページのリソースの読み込みに失敗した場合は、リロードする。
                if (window.___failedResources) {
                  console.log(`resources failed, SW updated - reloading`)
                  window.location.reload()
                }
              } else {
                // この時点で、すべてがプリキャッシュされている。
                // "Content is cached for offline use." というメッセージを表示するのに最適なタイミングである。
                console.log(`Content is now available offline!`)

                // インストールが完了したことを Service Worker へ通知する。
                // イベントリスナーが追加される時間を確保するために遅延させる。
                // そうしないと fetch が早く呼ばれすぎて、リソースがキャッシュされない。
                apiRunner(`onServiceWorkerInstalled`, { serviceWorker: reg })
              }
              break

            case `redundant`:
              console.error(`The installing service worker became redundant.`)
              apiRunner(`onServiceWorkerRedundant`, { serviceWorker: reg })
              break

            case `activated`:
              apiRunner(`onServiceWorkerActive`, { serviceWorker: reg })
              break
          }
        })
      })
    })
    .catch(function (e) {
      console.error(`Error during service worker registration:`, e)
    })
}
