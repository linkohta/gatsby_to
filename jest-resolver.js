// ESM 専用パッケージの中には、`exports` に `import` 条件しか書いていないものがある
// （unicorn-magic 0.3 など）。Jest は ESM を CommonJS に変換してから `require` として
// 解決するため、そのままではこうしたパッケージを見つけられない。
// 通常の解決に失敗したときだけ、`import` 条件を加えてもう一度解決する
module.exports = (request, options) => {
  try {
    return options.defaultResolver(request, options)
  } catch (error) {
    try {
      return options.defaultResolver(request, {
        ...options,
        conditions: [...(options.conditions ?? []), `import`],
      })
    } catch {
      // 利用者に見せるのは通常の解決で出たエラーにする
      throw error
    }
  }
}
