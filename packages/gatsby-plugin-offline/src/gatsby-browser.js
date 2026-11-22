exports.registerServiceWorker = () => process.env.GATSBY_IS_PREVIEW !== `true`

// このページに関係するリソースだけをキャッシュする
const whiteListLinkRels = /^(stylesheet|preload)$/
const prefetchedPathnames = []

exports.onServiceWorkerActive = ({
  getResourceURLsForPathname,
  serviceWorker,
}) => {
  if (process.env.GATSBY_IS_PREVIEW === `true`) {
    return
  }

  // SW が更新された直後の場合は、パスの依存関係を消去し、何もキャッシュしない。
  // 別のページへ遷移するまでは古いリビジョンのままだからである
  if (window.___swUpdated) {
    serviceWorker.active.postMessage({ gatsbyApi: `clearPathResources` })
    return
  }

  // document の head からノードを取得する
  const nodes = document.querySelectorAll(`
    head > script[src],
    head > link[href],
    head > style[data-href]
  `)

  // すべてのリソースの URL を取得する
  const headerResources = [].slice
    .call(nodes)
    // preconnect/prefetch/prerender のリソースは含めない
    .filter(
      node =>
        node.tagName !== `LINK` ||
        whiteListLinkRels.test(node.getAttribute(`rel`))
    )
    .map(node => node.src || node.href || node.getAttribute(`data-href`))

  // prefetch されたページをループしてリソースを配列に追加し、
  // さらに、それらのパスに必要なリソースを記録する。
  const prefetchedResources = []
  prefetchedPathnames.forEach(path => {
    const resources = getResourceURLsForPathname(path)
    prefetchedResources.push(...resources)

    serviceWorker.active.postMessage({
      gatsbyApi: `setPathResources`,
      path,
      resources,
    })
  })

  // すべてのリソースをループして、ページコンポーネントと JSON データを fetch し、
  // SW のキャッシュに追加する。
  const resources = [...headerResources, ...prefetchedResources]
  resources.forEach(resource => {
    // 各リソースの prefetch 用の link を作成し、Workbox がランタイムキャッシュするようにする
    const link = document.createElement(`link`)
    link.rel = `prefetch`
    link.href = resource

    link.onload = link.remove
    link.onerror = link.remove

    document.head.appendChild(link)
  })
}

function setPathResources(path, getResourceURLsForPathname) {
  // SW が更新された直後の場合は何もしない。メモリー上に古いページが残っていて、
  // それらをホワイトリストに入れたくないためである
  if (window.___swUpdated) return

  if (`serviceWorker` in navigator) {
    const { serviceWorker } = navigator

    if (serviceWorker.controller === null) {
      // SW がインストールされていない場合は、発生した prefetch を記録しておき、
      // インストール後に SW のキャッシュへ追加できるようにする必要がある
      prefetchedPathnames.push(path)
    } else {
      const resources = getResourceURLsForPathname(path)
      serviceWorker.controller.postMessage({
        gatsbyApi: `setPathResources`,
        path,
        resources,
      })
    }
  }
}

exports.onRouteUpdate = ({ location, getResourceURLsForPathname }) => {
  const pathname = location.pathname.replace(__BASE_PATH__, ``)
  setPathResources(pathname, getResourceURLsForPathname)

  if (
    `serviceWorker` in navigator &&
    navigator.serviceWorker.controller !== null
  ) {
    navigator.serviceWorker.controller.postMessage({
      gatsbyApi: `enableOfflineShell`,
    })
  }
}

exports.onPostPrefetchPathname = ({ pathname, getResourceURLsForPathname }) => {
  setPathResources(pathname, getResourceURLsForPathname)
}
