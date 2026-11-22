import webpack from "webpack"

export function build(webpackConfig: webpack.Configuration): Promise<{
  stats: webpack.Stats
  close: () => Promise<void>
}> {
  const compiler = webpack(webpackConfig)

  return new Promise((resolve, reject) => {
    compiler.run((err, stats) => {
      // stats が空になるのはエラーが発生したときだけである。if の条件に加えておくと TypeScript の型チェックが通る。
      if (err || !stats) {
        return compiler.close(() => {
          reject(err)
        })
      }

      if (stats.hasErrors()) {
        return compiler.close(() => {
          reject(stats.compilation.errors)
        })
      }

      return resolve({
        stats,
        close: (): Promise<void> =>
          new Promise((resolve, reject) =>
            compiler.close(err => (err ? reject(err) : resolve()))
          ),
      })
    })
  })
}

export function watch(
  webpackConfig: webpack.Configuration,
  onWatch: (
    err: Error | webpack.WebpackError | undefined | null,
    stats: webpack.Stats | undefined
  ) => void,
  watchOptions: webpack.Watching["watchOptions"] = {}
): {
  watcher: webpack.Watching
  close: () => Promise<void>
} {
  const compiler = webpack(webpackConfig)

  const watcher = compiler.watch(watchOptions, (err, stats) => {
    // これは複数回実行される
    onWatch(err, stats)
  })

  return {
    watcher,
    close: (): Promise<void> =>
      new Promise((resolve, reject) =>
        watcher.close(err => (err ? reject(err) : resolve()))
      ),
  }
}
