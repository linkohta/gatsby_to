import { BaseLoader, PageResourceStatus } from "./loader"
import { findPath } from "./find-path"

import getSocket from "./socketIo"
import normalizePagePath from "./normalize-page-path"

// TODO lodash の使用をやめる
import isEqual from "lodash/isEqual"

function mergePageEntry(cachedPage, newPageData) {
  return {
    ...cachedPage,
    payload: {
      ...cachedPage.payload,
      json: {
        // SSR の場合、cachedPage は "data" と "serverData" を含むことがある
        // 一方で newPageData は、何が更新されたかによって "data" だけ、または "serverData" だけを含むことがある
        ...cachedPage.payload.json,
        ...newPageData.result,
      },
      page: {
        ...cachedPage.payload.page,
        getServerDataError: newPageData.getServerDataError,
        staticQueryResults: newPageData.staticQueryResults,
      },
    },
  }
}

class DevLoader extends BaseLoader {
  constructor(asyncRequires, matchPaths) {
    const loadComponent = (chunkName, exportType = `components`) => {
      if (!this.asyncRequires[exportType][chunkName]) {
        if (exportType === `head`) {
          return null
        }
        throw new Error(
          `We couldn't find the correct component chunk with the name "${chunkName}"`
        )
      }

      return (
        this.asyncRequires[exportType][chunkName]()
          // コンポーネントがエラーの場合は loader が処理する
          .catch(err => err)
      )
    }
    super(loadComponent, matchPaths)
    this.asyncRequires = asyncRequires

    const socket = getSocket()

    this.notFoundPagePathsInCaches = new Set()

    if (socket) {
      socket.on(`message`, msg => {
        if (msg.type === `staticQueryResult`) {
          this.handleStaticQueryResultHotUpdate(msg)
        } else if (msg.type === `pageQueryResult`) {
          this.handlePageQueryResultHotUpdate(msg)
        } else if (msg.type === `sliceQueryResult`) {
          this.handleSliceQueryResultHotUpdate(msg)
        } else if (msg.type === `stalePageData`) {
          this.handleStalePageDataMessage(msg)
        } else if (msg.type === `staleServerData`) {
          this.handleStaleServerDataMessage(msg)
        }
      })
    } else if (process.env.NODE_ENV !== `test`) {
      console.warn(`Could not get web socket`)
    }
  }

  updateAsyncRequires(asyncRequires) {
    this.asyncRequires = asyncRequires
  }

  loadPage(pagePath) {
    const realPath = findPath(pagePath)
    return super.loadPage(realPath).then(result => {
      if (this.isPageNotFound(realPath)) {
        this.notFoundPagePathsInCaches.add(realPath)
      }

      return result
    })
  }

  loadPageDataJson(rawPath) {
    return super.loadPageDataJson(rawPath).then(data => {
      // 適切な 404.html が見つからない場合は dev-404-page にフォールバックする。
      // その場合は、見つからなかったことを必ずマークしておく必要がある。
      if (
        data.status === PageResourceStatus.Error &&
        rawPath !== `/dev-404-page/`
      ) {
        console.error(
          `404 page could not be found. Checkout https://www.gatsbyjs.com/docs/how-to/adding-common-features/add-404-page/`
        )
        return this.loadPageDataJson(`/dev-404-page/`).then(result =>
          Object.assign({}, data, result)
        )
      }

      return data
    })
  }

  doPrefetch(pagePath) {
    if (process.env.GATSBY_QUERY_ON_DEMAND) {
      return Promise.resolve()
    }
    return super.doPrefetch(pagePath).then(result => result.payload)
  }

  handleStaticQueryResultHotUpdate(msg) {
    const newResult = msg.payload.result

    const cacheKey = msg.payload.id
    const cachedResult = this.staticQueryDb[cacheKey]
    if (!isEqual(newResult, cachedResult)) {
      this.staticQueryDb[cacheKey] = newResult
      ___emitter.emit(`staticQueryResult`, newResult)
    }
  }

  handleSliceQueryResultHotUpdate(msg) {
    const newResult = msg.payload.result

    const cacheKey = msg.payload.id

    // 生の JSON の DB
    {
      const cachedResult = this.slicesDataDb.get(cacheKey)
      if (!isEqual(newResult, cachedResult)) {
        this.slicesDataDb.set(cacheKey, newResult)
      }
    }

    // 処理済みのデータ
    {
      const cachedResult = this.slicesDb.get(cacheKey)
      if (
        !isEqual(newResult?.result?.data, cachedResult?.data) ||
        !isEqual(newResult?.result?.sliceContext, cachedResult?.sliceContext)
      ) {
        const mergedResult = {
          ...cachedResult,
          data: newResult?.result?.data,
          sliceContext: newResult?.result?.sliceContext,
        }
        this.slicesDb.set(cacheKey, mergedResult)
        ___emitter.emit(`sliceQueryResult`, mergedResult)
      }
    }
  }

  updatePageData = (pagePath, newPageData) => {
    const pageDataDbCacheKey = normalizePagePath(pagePath)
    const cachedPageData = this.pageDataDb.get(pageDataDbCacheKey)?.payload

    if (!isEqual(newPageData, cachedPageData)) {
      // TODO: これが現在のページの更新で、まだキャッシュされていない静的クエリが新しく追加されていても、
      // 現状ではそれらを取得するきっかけがない（困った）
      // pageDataDb の正規のキーは常に更新する
      this.pageDataDb.set(pageDataDbCacheKey, {
        pagePath: pageDataDbCacheKey,
        payload: newPageData,
        status: `success`,
      })

      const cachedPage = this.pageDb.get(pageDataDbCacheKey)
      if (cachedPage) {
        this.pageDb.set(
          pageDataDbCacheKey,
          mergePageEntry(cachedPage, newPageData)
        )
      }

      // さらに、これが "/404.html" のクエリ結果である場合は、
      // ユーザーがアクセスしようとしたがページがなかったパスも
      // すべて更新する必要がある。それらはユーザーがアクセスしようとした
      // （正規化済みの）パスで保存しているためである
      if (pageDataDbCacheKey === `/404.html`) {
        this.notFoundPagePathsInCaches.forEach(notFoundPath => {
          const previousPageDataEntry = this.pageDataDb.get(notFoundPath)
          if (previousPageDataEntry) {
            this.pageDataDb.set(notFoundPath, {
              ...previousPageDataEntry,
              payload: newPageData,
            })
          }

          const previousPageEntry = this.pageDb.get(notFoundPath)
          if (previousPageEntry) {
            this.pageDb.set(
              notFoundPath,
              mergePageEntry(previousPageEntry, newPageData)
            )
          }
        })
      }
      return true
    }
    return false
  }

  markAsStale = dirtyQueryId => {
    if (dirtyQueryId === `/dev-404-page/` || dirtyQueryId === `/404.html`) {
      // これらのページはオンデマンドではないのでスキップする
      return
    }

    const normalizedId = normalizePagePath(dirtyQueryId)

    // キャッシュ内の項目を単純に削除することはできない。削除すると、
    // history.back() を使ったときに dev-404 ページが表示されてしまう
    // （root.js での特別な扱い、つまり loader.isPageNotFound のチェックによる）
    // そのため、代わりに stale とマークし、stale とマークされたリソースは
    // 再取得するよう loader の非同期メソッドに指示する

    const cachedPageData = this.pageDataDb.get(normalizedId)
    if (cachedPageData) {
      // キャッシュにページデータがある場合は、stale とマークする
      this.pageDataDb.set(normalizedId, {
        ...cachedPageData,
        stale: true,
      })
    }

    const cachedPage = this.pageDb.get(normalizedId)
    if (cachedPage) {
      // キャッシュにページデータがある場合は、stale とマークする
      this.pageDb.set(normalizedId, {
        ...cachedPage,
        payload: { ...cachedPage.payload, stale: true },
      })
    }
  }

  handlePageQueryResultHotUpdate(msg) {
    const updated = this.updatePageData(msg.payload.id, msg.payload.result)
    if (updated) {
      ___emitter.emit(`pageQueryResult`, msg.payload.result)
    }
  }

  handleStalePageDataMessage(msg) {
    for (const dirtyQueryId of msg.payload.stalePageDataPaths) {
      this.markAsStale(dirtyQueryId)
    }
  }

  handleStaleServerDataMessage() {
    const activePath = normalizePagePath(location.pathname)

    // 今のところ、serverData を持つページはすべて無効化する
    for (const [key, value] of this.pageDataDb) {
      if (value?.payload?.result?.serverData) {
        this.markAsStale(key)
      }
      if (activePath === normalizePagePath(key)) {
        this.reFetchServerData(activePath)
      }
    }
  }

  reFetchServerData(pagePath) {
    this.fetchPageDataJson({ pagePath }).then(data => {
      const updated = this.updatePageData(data.pagePath, data.payload)
      // SSR は遅いことがあるので、まだ同じページにいる場合に限って
      // serverDataResult を emit する
      if (updated && pagePath === normalizePagePath(location.pathname)) {
        ___emitter.emit(`serverDataResult`, data.payload)
      }
    })
  }
}

export default DevLoader
