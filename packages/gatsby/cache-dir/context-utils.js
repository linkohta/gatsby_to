import React from "react"

// serverContext を複数回作成すると React が例外を投げるため、2 回以上作成されないようにする
// https://github.com/facebook/react/blob/dd2d6522754f52c70d02c51db25eb7cbd5d1c8eb/packages/react/src/ReactServerContext.js#L101
const createServerContext = (name, defaultValue = null) => {
  /* eslint-disable no-undef */
  if (!globalThis.__SERVER_CONTEXT) {
    globalThis.__SERVER_CONTEXT = {}
  }

  if (!globalThis.__SERVER_CONTEXT[name]) {
    globalThis.__SERVER_CONTEXT[name] = React.createServerContext(
      name,
      defaultValue
    )
  }

  return globalThis.__SERVER_CONTEXT[name]
}

function createServerOrClientContext(name, defaultValue) {
  if (React.createServerContext) {
    return createServerContext(name, defaultValue)
  }

  return React.createContext(defaultValue)
}

export { createServerOrClientContext }
