import * as React from "react"
import { NavigateOptions, LinkProps } from "@reach/router" // これらは `@types/reach__router` に由来する

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface GatsbyLinkProps<TState> extends LinkProps<TState> {
  /** この Link がアクティブなときに適用するクラス */
  activeClassName?: string
  /** この Link がアクティブなときのインラインスタイル */
  activeStyle?: object
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  /** `to` が現在の URL の前方に一致する部分一致の場合に、リンクをハイライト対象として扱う */
  partiallyActive?: boolean
  /** このリンクが、履歴の中の現在の URL をリンク先で置き換えることを宣言するために使う */
  replace?: boolean
  /** リンク先のページへ state のデータを渡すために使う。
   * リンク先のページは `location` prop を持ち、その中のネストした `state` オブジェクトに渡したデータが入る。
   */
  state?: TState
  /** リンク先の URL */
  to: string
}

/**
 * このコンポーネントは、Gatsby が扱うページへのリンク _だけ_ を対象にしている。ほかのドメインのページや、
 * 同じドメインでも現在の Gatsby サイトが扱わないページへのリンクには、通常の `<a>` 要素を使うこと。
 */
export class Link<TState> extends React.Component<
  GatsbyLinkProps<TState>,
  any
> {}

/**
 * フォームの送信時など、プログラムからページを移動する必要が生じることがある。そのような
 * 場合、`Link` は使えない。
 */
export const navigate: {
  (to: string, options?: NavigateOptions<{}>): void
  (to: number): void
}

/**
 * サイトをサブディレクトリでホストすることはよくある。Gatsby ではサイトのパスプレフィックスを設定できる。
 * 設定すると、Gatsby の `<Link>` コンポーネントは開発時と本番の両方で、正しい URL を
 * 自動的に組み立てる
 */
export const withPrefix: (path: string) => string
export const withAssetPrefix: (path: string) => string
