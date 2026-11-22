import React from "react"
import { Router, Location, BaseContext } from "@gatsbyjs/reach-router"
import { ScrollContext } from "gatsby-react-router-scroll"

import { SlicesMapContext, SlicesContext } from "./slice/context"
import { shouldUpdateScroll, RouteUpdates } from "./navigation"
import { apiRunner } from "./api-runner-browser"
import loader from "./loader"
import {
  PageQueryStore,
  StaticQueryStore,
  SliceDataStore,
} from "./query-result-store"
import EnsureResources from "./ensure-resources"
import FastRefreshOverlay from "./fast-refresh-overlay"

// gatsby v2 では、matchPath を使うページで Router を使う場合、
// パスに完全なパスを含める必要がある。
// 例:
//   - ページの matchPath が `/app/*` である
//   - テンプレート内では、ユーザーはパスとして `/app/xyz` を使う必要がある
// 破壊的変更を持ち込まないよう、`basepath`/`baseuri` をリセットして
// 現在の挙動を維持する。
// v3 で削除する
const RouteHandler = props => (
  <BaseContext.Provider
    value={{
      baseuri: `/`,
      basepath: `/`,
    }}
  >
    <PageQueryStore {...props} />
  </BaseContext.Provider>
)

class LocationHandler extends React.Component {
  render() {
    const { location } = this.props

    const slicesContext = {
      renderEnvironment: `browser`,
    }

    if (!loader.isPageNotFound(location.pathname + location.search)) {
      return (
        <EnsureResources location={location}>
          {locationAndPageResources => (
            <SlicesContext.Provider value={slicesContext}>
              <SlicesMapContext.Provider
                value={locationAndPageResources.pageResources.page.slicesMap}
              >
                <RouteUpdates location={location}>
                  <ScrollContext
                    location={location}
                    shouldUpdateScroll={shouldUpdateScroll}
                  >
                    <Router
                      basepath={__BASE_PATH__}
                      location={location}
                      id="gatsby-focus-wrapper"
                    >
                      <RouteHandler
                        path={encodeURI(
                          (
                            locationAndPageResources.pageResources.page
                              .matchPath ||
                            locationAndPageResources.pageResources.page.path
                          ).split(`?`)[0]
                        )}
                        {...this.props}
                        {...locationAndPageResources}
                      />
                    </Router>
                  </ScrollContext>
                </RouteUpdates>
              </SlicesMapContext.Provider>
            </SlicesContext.Provider>
          )}
        </EnsureResources>
      )
    }

    const dev404PageResources = loader.loadPageSync(`/dev-404-page`)
    const real404PageResources = loader.loadPageSync(`/404.html`)
    let custom404
    if (real404PageResources) {
      custom404 = (
        <PageQueryStore {...this.props} pageResources={real404PageResources} />
      )
    }

    return (
      <EnsureResources location={location}>
        {locationAndPageResources => (
          <SlicesContext.Provider value={slicesContext}>
            <SlicesMapContext.Provider
              value={locationAndPageResources.pageResources.page.slicesMap}
            >
              <RouteUpdates location={location}>
                <Router
                  basepath={__BASE_PATH__}
                  location={location}
                  id="gatsby-focus-wrapper"
                >
                  <RouteHandler
                    path={location.pathname}
                    location={location}
                    pageResources={dev404PageResources}
                    custom404={custom404}
                  />
                </Router>
              </RouteUpdates>
            </SlicesMapContext.Provider>
          </SlicesContext.Provider>
        )}
      </EnsureResources>
    )
  }
}

const Root = () => (
  <Location>
    {locationContext => <LocationHandler {...locationContext} />}
  </Location>
)

// Redux などのために、サイトやプラグインがサイト全体をラップできるようにする。
const rootWrappedWithWrapRootElement = apiRunner(
  `wrapRootElement`,
  { element: <Root /> },
  <Root />,
  ({ result, plugin }) => {
    return { element: result }
  }
).pop()

function RootWrappedWithOverlayAndProvider() {
  return (
    <FastRefreshOverlay>
      <SliceDataStore>
        <StaticQueryStore>{rootWrappedWithWrapRootElement}</StaticQueryStore>
      </SliceDataStore>
    </FastRefreshOverlay>
  )
}

export default RootWrappedWithOverlayAndProvider
