const isEqual = require(`lodash/isEqual`)

const { emitter, store } = require(`../../redux`)
const { actions } = require(`../../redux/actions`)

const originalStatusPageByStatus = {}
const originalStatusPageByPath = {}

emitter.on(`CREATE_PAGE`, action => {
  // /404/ を /404.html に、/500/ を /500.html にコピーする。多くの静的サイトホスティングは、
  // サイトの 404 ページがこの名前であることを期待している。さらに、Rendering Engines では
  // 実行時エラーが起きることがあり、その場合は "/500.html" ページにフォールバックする。
  // https://www.gatsbyjs.com/docs/how-to/adding-common-features/add-404-page/
  const result = /^\/?(404|500)\/?$/.exec(action.payload.path)
  if (result && result.length > 1) {
    const status = result[1]

    const originalPage = originalStatusPageByStatus[status]

    const pageToStore = {
      path: action.payload.path,
      component: action.payload.component,
      context: action.payload.context,
      slices: action.payload.slices,
      status,
    }

    if (!originalPage || !isEqual(originalPage, pageToStore)) {
      originalStatusPageByStatus[status] = pageToStore
      originalStatusPageByPath[action.payload.path] = pageToStore

      store.dispatch(
        actions.createPage(
          {
            ...pageToStore,
            path: `/${status}.html`,
          },
          action.plugin,
          action
        )
      )
    }
  }
})

emitter.on(`DELETE_PAGE`, action => {
  const storedPage = originalStatusPageByPath[action.payload.path]
  if (storedPage) {
    store.dispatch(
      actions.deletePage({
        ...storedPage,
        path: `/${storedPage.status}.html`,
      })
    )
    originalStatusPageByPath[action.payload.path] = null
    originalStatusPageByStatus[storedPage.status] = null
  }
})
