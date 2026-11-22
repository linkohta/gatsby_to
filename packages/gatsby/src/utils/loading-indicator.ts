import { Express } from "express"
import { writeModule } from "./gatsby-webpack-virtual-modules"

// 最初に値を undefined に設定する。インジケーターをデフォルトで有効にすべきかを
// 判定するのに必要な環境変数が、まだ設定されていないかもしれないためである。ローディング
// インジケーターが許可されている場合は、モジュールを最初に書き出すときに "initial" に設定する
// "initial" は、表示すべきかをブラウザーが判断することを意味する
// 今のところ、cypress で実行されているときはデフォルトで無効にしている。
// ユーザーが E2E テストを繰り返し調整するときに、問題を起こさないようにするためである
// この確認は、将来、同様の他の状況にも対応するように
// 拡張できる。
let indicatorEnabled: "auto" | true | false | undefined = undefined

export function writeVirtualLoadingIndicatorModule(): void {
  if (indicatorEnabled === undefined) {
    indicatorEnabled =
      process.env.GATSBY_QUERY_ON_DEMAND &&
      process.env.GATSBY_QUERY_ON_DEMAND_LOADING_INDICATOR === `true`
        ? `auto`
        : false
  }

  writeModule(
    `$virtual/loading-indicator.js`,
    `
    export function isLoadingIndicatorEnabled() {
    return ${
      indicatorEnabled === `auto`
        ? `\`Cypress\` in window
          ? false
          : true`
        : JSON.stringify(indicatorEnabled)
    }
  }`
  )
}

export function routeLoadingIndicatorRequests(app: Express): void {
  app.get(`/___loading-indicator/:method?`, (req, res) => {
    if (req.params.method === `enable` && indicatorEnabled !== true) {
      indicatorEnabled = true
      writeVirtualLoadingIndicatorModule()
    } else if (req.params.method === `disable` && indicatorEnabled !== false) {
      indicatorEnabled = false
      writeVirtualLoadingIndicatorModule()
    } else if (req.params.method === `auto` && indicatorEnabled !== `auto`) {
      indicatorEnabled = `auto`
      writeVirtualLoadingIndicatorModule()
    }

    res.status(200).send({
      status:
        indicatorEnabled === `auto`
          ? `auto`
          : indicatorEnabled
          ? `enabled`
          : `disabled`,
    })
  })
}
