import { ip as getLanIp } from "address"
import chalk from "chalk"
import url from "url"

export interface IPreparedUrls {
  lanUrlForConfig: string
  lanUrlForTerminal: string
  localUrlForTerminal: string
  localUrlForBrowser: string
}

export function prepareUrls(
  protocol: `http` | `https`,
  host: string,
  port: number
): IPreparedUrls {
  const formatUrl = (hostname: string): string =>
    url.format({
      protocol,
      hostname,
      port,
      pathname: `/`,
    })
  const prettyPrintUrl = (hostname: string): string =>
    url.format({
      protocol,
      hostname,
      port: chalk.bold(String(port)),
      pathname: `/`,
    })

  const isUnspecifiedHost = host === `0.0.0.0` || host === `::`
  let prettyHost = host
  let lanUrlForConfig
  let lanUrlForTerminal
  if (isUnspecifiedHost) {
    prettyHost = `localhost`

    try {
      // これは IPv4 アドレスしか返せない
      lanUrlForConfig = getLanIp()
      if (lanUrlForConfig) {
        // アドレスがプライベート IP であるかを確認する
        // https://en.wikipedia.org/wiki/Private_network#Private_IPv4_address_spaces
        if (
          /^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(
            lanUrlForConfig
          )
        ) {
          // アドレスはプライベートなので、後で使えるように整形する
          lanUrlForTerminal = prettyPrintUrl(lanUrlForConfig)
        } else {
          // アドレスはプライベートではないので、破棄する
          lanUrlForConfig = undefined
        }
      }
    } catch (_e) {
      // 無視する
    }
  }
  // TODO エラー（GraphQL と Webpack）を Redux に集めて、コンパイルのたびに
  // ターミナルを消去して出力できるようにする。
  // 整形して出力するコードは webpack のプラグインから借用する。
  const localUrlForTerminal = prettyPrintUrl(prettyHost)
  const localUrlForBrowser = formatUrl(prettyHost)
  return {
    lanUrlForConfig,
    lanUrlForTerminal,
    localUrlForTerminal,
    localUrlForBrowser,
  }
}
