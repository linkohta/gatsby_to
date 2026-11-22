import PropTypes from "prop-types"
import React from "react"
import { Link as ReachRouterLink, Location } from "@gatsbyjs/reach-router"
import { parsePath } from "./parse-path"
import { isLocalLink } from "./is-local-link"
import { rewriteLinkPath } from "./rewrite-link-path"
import { withPrefix, getGlobalPathPrefix } from "./prefix-helpers"

export { parsePath, withPrefix }

export function withAssetPrefix(path) {
  return withPrefix(path, getGlobalPathPrefix())
}

const NavLinkPropTypes = {
  activeClassName: PropTypes.string,
  activeStyle: PropTypes.object,
  partiallyActive: PropTypes.bool,
}

// IntersectionObserver を設定する
const createIntersectionObserver = (el, cb) => {
  const io = new window.IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (el === entry.target) {
        // 要素がビューポート内にあるかを確認し、リスナーを削除し、オブザーバーを破棄して、リンクのコールバックを実行する。
        // MSEdge は現在 isIntersecting に対応していないので、intersectionRatio > 0 も確認する
        cb(entry.isIntersecting || entry.intersectionRatio > 0)
      }
    })
  })

  // 要素をオブザーバーに追加する
  io.observe(el)

  return { instance: io, el }
}

function GatsbyLinkLocationWrapper(props) {
  return (
    <Location>
      {({ location }) => <GatsbyLink {...props} _location={location} />}
    </Location>
  )
}

class GatsbyLink extends React.Component {
  constructor(props) {
    super(props)
    // デフォルトでは IntersectionObserver に対応していないものとして扱う
    let IOSupported = false
    if (typeof window !== `undefined` && window.IntersectionObserver) {
      IOSupported = true
    }

    this.state = {
      IOSupported,
    }
    this.abortPrefetch = null
    this.handleRef = this.handleRef.bind(this)
  }

  _prefetch() {
    let currentPath = window.location.pathname + window.location.search

    // reach router が正しい state を持っているはずである
    if (this.props._location && this.props._location.pathname) {
      currentPath = this.props._location.pathname + this.props._location.search
    }

    const rewrittenPath = rewriteLinkPath(this.props.to, currentPath)
    const parsed = parsePath(rewrittenPath)

    const newPathName = parsed.pathname + parsed.search

    // プリフェッチは次のナビゲーションを速くするために使う。現在のナビゲーションに対して使うと、
    // Chrome がネットワークの完了を待たずに古いデータを使ってしまう競合状態が起こり得る
    if (currentPath !== newPathName) {
      return ___loader.enqueue(newPathName)
    }

    return undefined
  }

  componentWillUnmount() {
    if (!this.io) {
      return
    }
    const { instance, el } = this.io

    if (this.abortPrefetch) {
      this.abortPrefetch.abort()
    }

    instance.unobserve(el)
    instance.disconnect()
  }

  handleRef(ref) {
    if (
      this.props.innerRef &&
      Object.prototype.hasOwnProperty.call(this.props.innerRef, `current`)
    ) {
      this.props.innerRef.current = ref
    } else if (this.props.innerRef) {
      this.props.innerRef(ref)
    }

    if (this.state.IOSupported && ref) {
      // IO に対応しており、要素の参照が見つかった場合は、オブザーバーの機能を設定する
      this.io = createIntersectionObserver(ref, inViewPort => {
        if (inViewPort) {
          this.abortPrefetch = this._prefetch()
        } else {
          if (this.abortPrefetch) {
            this.abortPrefetch.abort()
          }
        }
      })
    }
  }

  defaultGetProps = ({ isPartiallyCurrent, isCurrent }) => {
    if (this.props.partiallyActive ? isPartiallyCurrent : isCurrent) {
      return {
        className: [this.props.className, this.props.activeClassName]
          .filter(Boolean)
          .join(` `),
        style: { ...this.props.style, ...this.props.activeStyle },
      }
    }
    return null
  }

  render() {
    const {
      to,
      getProps = this.defaultGetProps,
      onClick,
      onMouseEnter,
      /* eslint-disable no-unused-vars */
      activeClassName: $activeClassName,
      activeStyle: $activeStyle,
      innerRef: $innerRef,
      partiallyActive,
      state,
      replace,
      _location,
      /* eslint-enable no-unused-vars */
      ...rest
    } = this.props

    if (process.env.NODE_ENV !== `production` && !isLocalLink(to)) {
      console.warn(
        `External link ${to} was detected in a Link component. Use the Link component only for internal links. See: https://gatsby.dev/internal-links`
      )
    }

    const prefixedTo = rewriteLinkPath(to, _location.pathname)
    if (!isLocalLink(prefixedTo)) {
      return <a href={prefixedTo} {...rest} />
    }

    return (
      <ReachRouterLink
        to={prefixedTo}
        state={state}
        getProps={getProps}
        innerRef={this.handleRef}
        onMouseEnter={e => {
          if (onMouseEnter) {
            onMouseEnter(e)
          }
          const parsed = parsePath(prefixedTo)
          ___loader.hovering(parsed.pathname + parsed.search)
        }}
        onClick={e => {
          if (onClick) {
            onClick(e)
          }

          if (
            e.button === 0 && // 右クリックは無視する
            !this.props.target && // "target=_blank" はブラウザーに任せる
            !e.defaultPrevented && // onClick がデフォルトの動作を止めた
            !e.metaKey && // 修飾キーを伴うクリックは無視する...
            !e.altKey &&
            !e.ctrlKey &&
            !e.shiftKey
          ) {
            e.preventDefault()

            let shouldReplace = replace
            const isCurrent = encodeURI(prefixedTo) === _location.pathname

            if (typeof replace !== `boolean` && isCurrent) {
              shouldReplace = true
            }
            // 続行する前に、必要なスクリプトとデータが
            // 読み込まれていることを確認する。
            window.___navigate(prefixedTo, {
              state,
              replace: shouldReplace,
            })
          }

          return true
        }}
        {...rest}
      />
    )
  }
}

GatsbyLink.propTypes = {
  ...NavLinkPropTypes,
  onClick: PropTypes.func,
  to: PropTypes.string.isRequired,
  replace: PropTypes.bool,
  state: PropTypes.object,
}

export const Link = React.forwardRef((props, ref) => (
  <GatsbyLinkLocationWrapper innerRef={ref} {...props} />
))

export const navigate = (to, options) => {
  window.___navigate(rewriteLinkPath(to, window.location.pathname), options)
}
