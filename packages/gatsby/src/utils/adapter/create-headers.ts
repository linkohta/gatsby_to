import { match } from "@gatsbyjs/reach-router"
import type { IHeader } from "../../redux/types"
import { rankRoute } from "../rank-route"

type Headers = IHeader["headers"]
interface IHeaderWithScore extends IHeader {
  score: number
}

// パスの末尾にスラッシュがあるかどうかは問わないが、比較できるようにするために正規化する必要がある
const normalizePath = (input: string): string =>
  input.endsWith(`/`) ? input : `${input}/`

export const createHeadersMatcher = (
  headers: Array<IHeader> | undefined,
  pathPrefix: string
): ((path: string, defaultHeaders: Headers) => Headers) => {
  function stripPathPrefix(path: string): string {
    if (pathPrefix && path.startsWith(pathPrefix)) {
      path = path.slice(pathPrefix.length)
    }

    return path
  }

  // ユーザーから渡されたヘッダーを 2 つのグループに分ける:
  // - dynamicHeaders: 動的なパスを持つヘッダー（例: /* や /:tests）
  // - staticHeaders: 完全に静的なパスを持つヘッダー（例: /static/）
  // あわせて、rankRoute 関数を使ってそれぞれのヘッダーにスコアを付ける
  let dynamicHeaders: Array<IHeaderWithScore> = []
  const staticHeaders: Map<string, IHeader> = new Map()

  // ユーザーが gatsby-config で独自のヘッダーを定義していない場合は、デフォルトのヘッダーだけを返せばよい
  if (!headers || headers.length === 0) {
    return (_path: string, defaultHeaders: Headers) => defaultHeaders
  }

  for (const header of headers) {
    const source = stripPathPrefix(header.source)
    if (source.includes(`:`) || source.includes(`*`)) {
      // rankRoute は、"match" も使っている内部関数である
      const score = rankRoute(source)

      dynamicHeaders.push({
        ...header,
        score,
        source,
      })
    } else {
      staticHeaders.set(normalizePath(source), {
        ...header,
        source,
      })
    }
  }

  // 動的なヘッダーをスコアでソートし、最も具体的なものを配列の末尾へ移す
  // スコアが同じ場合は、source を辞書順で比較する
  dynamicHeaders = dynamicHeaders.sort((a, b) => {
    const order = a.score - b.score
    if (order !== 0) {
      return order
    }
    return a.source.localeCompare(b.source)
  })

  return (path: string, defaultHeaders: Headers): Headers => {
    path = stripPathPrefix(path)

    // 指定されたパスのヘッダーのマップを作成する
    // キーはヘッダーのキーになる。マップではキーは一度しか現れないので、同じキーを持つヘッダーのうち最後のものが優先される
    const uniqueHeaders: Map<string, string> = new Map()

    // 1. デフォルトのヘッダーを追加する
    for (const h of defaultHeaders) {
      uniqueHeaders.set(h.key, h.value)
    }

    // 2. 現在のパスに一致する動的なヘッダーを追加する
    for (const d of dynamicHeaders) {
      if (match(d.source, path)) {
        for (const h of d.headers) {
          uniqueHeaders.set(h.key, h.value)
        }
      }
    }

    const staticEntry = staticHeaders.get(normalizePath(path))

    // 3. 現在のパスに一致する静的なヘッダーを追加する
    if (staticEntry) {
      for (const h of staticEntry.headers) {
        uniqueHeaders.set(h.key, h.value)
      }
    }

    // マップをオブジェクトの配列に戻す
    return Array.from(uniqueHeaders.entries()).map(([key, value]) => {
      return {
        key,
        value,
      }
    })
  }
}
