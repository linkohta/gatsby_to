// eslint-disable-next-line no-unused-vars
import regeneratorRuntime from "regenerator-runtime"

import "graphiql/setup-workers/webpack"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { DEFAULT_PLUGINS, GraphiQL } from "graphiql"
import { getIntrospectionQuery } from "graphql"
import { codeExporterPlugin } from "@graphiql/plugin-code-exporter"

import { snippets } from "./code-exporter/snippets.js"
import { Logo } from "./logo.jsx"
import { transport, fetchFragments, locationQuery } from "./utils.js"
import { RefreshDataSourceButton } from "./toolbar.jsx"
import {
  FALLBACK_QUERY,
  GRAPHIQL_URL,
  LOCAL_STORAGE_NAMES,
  REFRESH_URL,
} from "./constants.js"

import "graphiql/style.css"
// コードエクスポーターは CodeMirror 5 でコードを表示する。graphiql 6 は Monaco に
// 移行して CodeMirror の CSS を含まなくなったので、ここで読み込む
import "codemirror/lib/codemirror.css"
import "@graphiql/plugin-code-exporter/style.css"
import "./app.css"

const parameters = {}

window.location.search
  .slice(1)
  .split(`&`)
  .forEach(function (entry) {
    const eq = entry.indexOf(`=`)
    if (eq >= 0) {
      parameters[decodeURIComponent(entry.slice(0, eq))] = decodeURIComponent(
        entry.slice(eq + 1)
      )
    }
  })

// クエリと変数の文字列が編集されたら、簡単に共有できるよう
// URL バーを更新する。
function onEditQuery(newQuery) {
  parameters.query = newQuery
  updateURL()
}

function onEditVariables(newVariables) {
  parameters.variables = newVariables
  updateURL()
}

function onEditHeaders(newHeaders) {
  parameters.headers = newHeaders
  updateURL()
}

function onEditOperationName(newOperationName) {
  parameters.operationName = newOperationName
  updateURL()
}

function onTabChange(tabsState) {
  const activeTab = tabsState.tabs[tabsState.activeTabIndex]
  parameters.query = activeTab.query
  parameters.variables = activeTab.variables
  parameters.headers = activeTab.headers
  updateURL()
}

function updateURL() {
  history.replaceState(null, null, locationQuery(parameters))
}

async function graphQLIntrospection() {
  const res = await fetch(GRAPHIQL_URL, {
    method: `POST`,
    headers: {
      Accept: `application/json`,
      "Content-Type": `application/json`,
    },
    credentials: `include`,
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  })

  return res.json()
}

const DEFAULT_QUERY =
  parameters.query ||
  (window.localStorage &&
    window.localStorage.getItem(LOCAL_STORAGE_NAMES.query)) ||
  FALLBACK_QUERY

// graphiql 6 では、ツールバーにボタンを足す方法がプラグインの `sessionActions` だけに
// なった。サイドバーにアイコンを増やさないよう、コードエクスポーターのプラグインに持たせる
const RefreshContext = React.createContext(null)

const RefreshAction = () => {
  const refreshExternalDataSource = React.useContext(RefreshContext)

  return refreshExternalDataSource ? (
    <RefreshDataSourceButton onClick={refreshExternalDataSource} />
  ) : null
}

const exporterPlugin = {
  ...codeExporterPlugin({ snippets }),
  sessionActions: RefreshAction,
}

const App = ({ initialExternalFragments }) => {
  const [refreshState, setRefreshState] = React.useState({
    enableRefresh: false,
    refreshToken: null,
  })
  const [externalFragments, setExternalFragments] = React.useState(
    initialExternalFragments
  )

  React.useEffect(() => {
    const fetchData = async () => {
      const result = await graphQLIntrospection()

      let { enableRefresh, refreshToken } = result.extensions

      switch (typeof enableRefresh) {
        case `string`: {
          const lowerCased = enableRefresh.toLowerCase()
          enableRefresh = lowerCased === `1` || lowerCased === `true`
          break
        }
        case `number`:
          enableRefresh = enableRefresh > 0
          break
      }

      setRefreshState({
        enableRefresh,
        refreshToken,
      })
    }

    fetchData()
  }, [])

  const refreshExternalDataSource = () => {
    const options = { method: `POST` }
    if (refreshState.refreshToken) {
      options.headers = {
        Authorization: refreshState.refreshToken,
      }
    }
    fetchFragments().then(updatedExternalFragments => {
      setExternalFragments(updatedExternalFragments)
    })

    return fetch(REFRESH_URL, options)
  }

  return (
    <RefreshContext.Provider
      value={refreshState.enableRefresh ? refreshExternalDataSource : null}
    >
      <GraphiQL
        transport={transport}
        brand={<Logo />}
        initialQuery={DEFAULT_QUERY}
        initialVariables={parameters.variables}
        initialHeaders={parameters.headers}
        onEditQuery={onEditQuery}
        onEditVariables={onEditVariables}
        onEditOperationName={onEditOperationName}
        onEditHeaders={onEditHeaders}
        onTabChange={onTabChange}
        externalFragments={externalFragments}
        plugins={[...DEFAULT_PLUGINS, exporterPlugin]}
      />
    </RefreshContext.Provider>
  )
}

const container = document.getElementById(`root`)
const root = createRoot(container)

// 起動時にフラグメントを取得する簡易的な方法
// フラグメントはホットリロードされない（再読み込みが必要）が、
// 最初の組み込みとしては十分である
fetchFragments().then(initialExternalFragments => {
  root.render(<App initialExternalFragments={initialExternalFragments} />)
})
