import React from "react"
import PropTypes from "prop-types"
import { createServerOrClientContext } from "./context-utils"

const StaticQueryContext = createServerOrClientContext(`StaticQuery`, {})

function StaticQueryDataRenderer({ staticQueryData, data, query, render }) {
  const finalData = data
    ? data.data
    : staticQueryData[query] && staticQueryData[query].data

  return (
    <React.Fragment>
      {finalData && render(finalData)}
      {!finalData && <div>Loading (StaticQuery)</div>}
    </React.Fragment>
  )
}

let warnedAboutStaticQuery = false

// TODO(v6): 完全に削除する
const StaticQuery = props => {
  const { data, query, render, children } = props

  if (process.env.NODE_ENV === `development` && !warnedAboutStaticQuery) {
    console.warn(
      `The <StaticQuery /> component is deprecated and will be removed in Gatsby v6. Use useStaticQuery instead. Refer to the migration guide for more information: https://gatsby.dev/migrating-4-to-5/#staticquery--is-deprecated`
    )
    warnedAboutStaticQuery = true
  }

  return (
    <StaticQueryContext.Consumer>
      {staticQueryData => (
        <StaticQueryDataRenderer
          data={data}
          query={query}
          render={render || children}
          staticQueryData={staticQueryData}
        />
      )}
    </StaticQueryContext.Consumer>
  )
}

StaticQuery.propTypes = {
  data: PropTypes.object,
  query: PropTypes.string.isRequired,
  render: PropTypes.func,
  children: PropTypes.func,
}

const useStaticQuery = query => {
  if (
    typeof React.useContext !== `function` &&
    process.env.NODE_ENV === `development`
  ) {
    // TODO(v5): React >= 18 を必須にしているので削除する
    throw new Error(
      `You're likely using a version of React that doesn't support Hooks\n` +
        `Please update React and ReactDOM to 16.8.0 or later to use the useStaticQuery hook.`
    )
  }

  const context = React.useContext(StaticQueryContext)

  // graphql でラップされている場合、query は `3303882` のような数値の文字列になる。ユーザーが
  // クエリを graphql でラップし忘れると、Number へのキャストが `NaN` になるので、
  // API の誤用を検知して適切な案内を出せる
  if (isNaN(Number(query))) {
    throw new Error(`useStaticQuery was called with a string but expects to be called using \`graphql\`. Try this:

import { useStaticQuery, graphql } from 'gatsby';

useStaticQuery(graphql\`${query}\`);
`)
  }

  if (context[query]?.data) {
    return context[query].data
  } else {
    throw new Error(
      `The result of this StaticQuery could not be fetched.\n\n` +
        `This is likely a bug in Gatsby and if refreshing the page does not fix it, ` +
        `please open an issue in https://github.com/gatsbyjs/gatsby/issues`
    )
  }
}

export { StaticQuery, StaticQueryContext, useStaticQuery }
