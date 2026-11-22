const map = new WeakMap()

export function reactDOMUtils() {
  const reactDomClient = require(`react-dom/client`)

  const render = (Component, el, options = {}) => {
    let root = map.get(el)
    if (!root) {
      // React 19 のエラー処理のオプションが渡された場合にだけ、オプションを渡す
      const rootOptions =
        options.onUncaughtError || options.onCaughtError
          ? {
              onUncaughtError: options.onUncaughtError,
              onCaughtError: options.onCaughtError,
            }
          : undefined

      map.set(el, (root = reactDomClient.createRoot(el, rootOptions)))
    }
    root.render(Component)
  }

  const hydrate = (Component, el, options = {}) => {
    // React 19 のエラー処理のオプションが渡された場合にだけ、オプションを渡す
    const hydrateOptions =
      options.onUncaughtError || options.onCaughtError
        ? {
            onUncaughtError: options.onUncaughtError,
            onCaughtError: options.onCaughtError,
          }
        : undefined

    const root = reactDomClient.hydrateRoot(el, Component, hydrateOptions)
    return root
  }

  return { render, hydrate }
}
