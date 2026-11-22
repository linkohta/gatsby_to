import escapeStringRegexp from "escape-string-regexp"
import { withPrefix } from "gatsby"

export const userIsForcingNavigation = event =>
  event.button !== 0 ||
  event.altKey ||
  event.ctrlKey ||
  event.metaKey ||
  event.shiftKey

// IE では anchor.pathname の先頭にスラッシュが付かない
export const slashedPathname = pathname =>
  pathname[0] === `/` ? pathname : `/${pathname}`

export const navigationWasHandledElsewhere = event => event.defaultPrevented

export const findClosestAnchor = node => {
  for (; node.parentNode; node = node.parentNode) {
    if (node.nodeName.toLowerCase() === `a`) {
      return node
    }
  }

  return null
}

export const anchorsTargetIsEquivalentToSelf = anchor =>
  /* target 属性がなければ _self として扱われる */
  anchor.hasAttribute(`target`) === false ||
  /**
   * ブラウザのデフォルトは _self だが、すべてのブラウザが
   * a.target に文字列 `_self` をデフォルトで設定するわけではない
   */

  /**
   * 前提: 一部のブラウザは、属性のデフォルト値に null/undefined を
   * 使う
   */
  anchor.target == null ||
  /**
   * 一部のブラウザは空文字列を _self の意味で使う。実際の `_self` かも
   * 確認する
   */
  [`_self`, ``].includes(anchor.target) ||
  /**
   * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a#attr-target に従う
   */
  (anchor.target === `_parent` &&
    (!anchor.ownerDocument.defaultView.parent || // 前提: これは falsy になりうる
      anchor.ownerDocument.defaultView.parent ===
        anchor.ownerDocument.defaultView)) ||
  (anchor.target === `_top` &&
    (!anchor.ownerDocument.defaultView.top || // 前提: これは falsy になりうる
      anchor.ownerDocument.defaultView.top ===
        anchor.ownerDocument.defaultView))

export const authorIsForcingNavigation = anchor =>
  /**
   * href をダウンロード用のファイルとして扱うようブラウザに伝える
   * HTML5 の属性。ブラウザに処理を任せる
   */
  anchor.hasAttribute(`download`) === true ||
  /**
   * target="_self" のアンカーに見えないものは、すべてブラウザに
   * 処理を任せる
   */
  anchorsTargetIsEquivalentToSelf(anchor) === false

// https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy
export const urlsAreOnSameOrigin = (origin, destination) =>
  origin.protocol === destination.protocol &&
  /* a.host には、ホスト名とポートの両方が host:port の形式で含まれる */
  origin.host === destination.host

export const pathIsNotHandledByApp = (destination, pathStartRegEx) => {
  const pathFileExtensionRegEx = /^.*\.((?!htm)[a-z0-9]{1,5})$/i

  return (
    /**
     * アプリで pathPrefix を使っていて、同じドメインだがアプリの pathPrefix の
     * 外を指すリンクがある場合のための処理。たとえば、Gatsby アプリが
     * https://example.com/myapp/ にあり、pathPrefix が `/myapp` に
     * 設定されているとする。同じドメインで /myapp のパスの外を指す
     * 絶対リンク、たとえば `<a
     * href="https://example.com/not-my-app">` を追加しても、プラグインはそれを捕捉せず、
     * 外部リンクとして遷移する。pushState を行って
     * `https://example.com/myapp/https://example.com/not-my-app` になってしまうことはない
     */
    pathStartRegEx.test(slashedPathname(destination.pathname)) === false ||
    /**
     * ファイルの拡張子に見えるもの（.htm/html 以外）を指すリンクは
     * 捕捉しない。
     */
    destination.pathname.search(pathFileExtensionRegEx) !== -1
  )
}

export const hashShouldBeFollowed = (origin, destination) =>
  destination.hash !== `` &&
  /**
   * 動的に作成されたアンカーリンク（href="#my-anchor"）は、IE では
   * pathname を持たないことがある
   */
  (destination.pathname === `` ||
    /* 同じページを指していてハッシュだけが付いたリンクは捕捉しない。 */
    destination.pathname === origin.pathname)

export const routeThroughBrowserOrApp =
  (hrefHandler, pluginOptions) => event => {
    if (window.___failedResources) return true

    if (userIsForcingNavigation(event)) return true

    if (navigationWasHandledElsewhere(event)) return true

    const clickedAnchor = findClosestAnchor(event.target)
    if (clickedAnchor == null) return true

    if (authorIsForcingNavigation(clickedAnchor)) return true

    // IE では、アンカーの作成後に href が変わると（React など）、host の値が消える。
    // host の値が確実に入るよう、新しいアンカー要素を作成する
    const destination = document.createElement(`a`)

    // https://html.spec.whatwg.org/multipage/links.html#concept-hyperlink-url-set
    // clickedAnchor が `<a>example</a>` のように href 属性を持たない場合、href のゲッターは空文字列を返す。
    if (clickedAnchor.href !== ``) {
      destination.href = clickedAnchor.href
    }

    if (
      `SVGAnimatedString` in window &&
      clickedAnchor.href instanceof SVGAnimatedString
    ) {
      destination.href = clickedAnchor.href.animVal
    }

    // IE では、デフォルトのポートがアンカーの host には含まれるが、
    // location の host には含まれない。そのため、location の host と
    // アンカーの host を直接比較できない。たとえば http://example.com では、
    // location.host が 'example.com'、destination.host が
    // 'example.com:80' になる。host の値を正規化するために、location.href から
    // アンカーを作成する。
    const origin = document.createElement(`a`)
    origin.href = window.location.href

    if (urlsAreOnSameOrigin(origin, destination) === false) return true

    // pathname を pathPrefix と照合するための正規表現
    const pathStartRegEx = new RegExp(`^${escapeStringRegexp(withPrefix(`/`))}`)

    if (pathIsNotHandledByApp(destination, pathStartRegEx)) return true

    if (hashShouldBeFollowed(origin, destination)) return true

    if (pluginOptions.excludePattern) {
      const excludeRegex = new RegExp(pluginOptions.excludePattern)
      if (excludeRegex.test(destination.pathname)) {
        return true
      }
    }

    event.preventDefault()

    // issue #8907 を参照: destination.pathname には gatsby-transformer-remark が付けた
    // pathPrefix がすでに含まれているが、gatsby-link.navigate にはそれを含まない href が必要である
    const destinationPathname = slashedPathname(destination.pathname).replace(
      pathStartRegEx,
      `/`
    )

    hrefHandler(
      `${destinationPathname}${destination.search}${destination.hash}`
    )

    return false
  }

export default function (root, pluginOptions, cb) {
  const clickHandler = routeThroughBrowserOrApp(cb, pluginOptions)

  root.addEventListener(`click`, clickHandler)

  return () => root.removeEventListener(`click`, clickHandler)
}
