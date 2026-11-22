import * as React from "react"
import { LocationContext } from "@gatsbyjs/reach-router"
import PropTypes from "prop-types"
import { SessionStorage } from "./session-storage"

export const ScrollContext = React.createContext<SessionStorage>(
  new SessionStorage()
)
ScrollContext.displayName = `GatsbyScrollContext`

type ShouldUpdateScrollFn = (
  prevRouterProps: LocationContext | undefined,
  routerProps: LocationContext
) => boolean
type ShouldUpdateScroll = undefined | ShouldUpdateScrollFn

export class ScrollHandler extends React.Component<
  LocationContext & { shouldUpdateScroll: ShouldUpdateScroll }
> {
  static propTypes = {
    shouldUpdateScroll: PropTypes.func,
    children: PropTypes.element.isRequired,
    location: PropTypes.object.isRequired,
  }

  _stateStorage: SessionStorage = new SessionStorage()

  // @see https://www.html5rocks.com/en/tutorials/speed/animations/
  _isTicking = false
  _latestKnownScrollY = 0
  scrollListener = (): void => {
    this._latestKnownScrollY = window.scrollY

    if (!this._isTicking) {
      this._isTicking = true
      requestAnimationFrame(this._saveScroll.bind(this))
    }
  }

  _saveScroll(): void {
    const key = this.props.location.key || null

    if (key) {
      this._stateStorage.save(
        this.props.location,
        key,
        this._latestKnownScrollY
      )
    }
    this._isTicking = false
  }

  componentDidMount(): void {
    window.addEventListener(`scroll`, this.scrollListener)
    let scrollPosition
    const { key, hash } = this.props.location

    if (key) {
      scrollPosition = this._stateStorage.read(this.props.location, key)
    }

    /** コンポーネントのマウント時にブラウザーの URL にハッシュがある場合（つまり、ユーザーが外部のサイトから
     * 移動してきた場合）は、以前に保存したスクロール位置ではなく、そのハッシュの位置へ
     * スクロールする。 */
    if (hash) {
      this.scrollToHash(decodeURI(hash), undefined)
    } else if (scrollPosition) {
      this.windowScroll(scrollPosition, undefined)
    }
  }

  componentWillUnmount(): void {
    window.removeEventListener(`scroll`, this.scrollListener)
  }

  componentDidUpdate(prevProps: LocationContext): void {
    const { hash, key } = this.props.location
    let scrollPosition

    if (key) {
      scrollPosition = this._stateStorage.read(this.props.location, key)
    }

    /**  状態は 2 つある。ブラウザーの URL と、
     * スクロール位置を記録している history の state である
     * ネイティブの挙動では、ユーザーがブラウザーで戻ったとき（`POP` アクション）に
     * スクロール位置を復元することになっている
     * 現在、reach router にはこれを妨げるバグがある: https://github.com/reach/router/issues/228
     * そのため、_常に_ URL を信頼できる情報源として扱う。URL に
     * ハッシュが含まれていれば、そこへスクロールする
     */

    if (hash) {
      this.scrollToHash(decodeURI(hash), prevProps)
    } else {
      this.windowScroll(scrollPosition, prevProps)
    }
  }

  windowScroll = (
    position: number,
    prevProps: LocationContext | undefined
  ): void => {
    if (this.shouldUpdateScroll(prevProps, this.props)) {
      window.scrollTo(0, position)
    }
  }

  scrollToHash = (
    hash: string,
    prevProps: LocationContext | undefined
  ): void => {
    const node = document.getElementById(hash.substring(1))

    if (node && this.shouldUpdateScroll(prevProps, this.props)) {
      node.scrollIntoView()
    }
  }

  shouldUpdateScroll = (
    prevRouterProps: LocationContext | undefined,
    routerProps: LocationContext
  ): boolean => {
    const { shouldUpdateScroll } = this.props
    if (!shouldUpdateScroll) {
      return true
    }

    // this._stateStorage にアクセスできるようにするためのハック。
    return shouldUpdateScroll.call(this, prevRouterProps, routerProps)
  }

  render(): React.ReactNode {
    return (
      <ScrollContext.Provider value={this._stateStorage}>
        {this.props.children}
      </ScrollContext.Provider>
    )
  }
}
