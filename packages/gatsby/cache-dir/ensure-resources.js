import React from "react"
import loader, { PageResourceStatus } from "./loader"
import shallowCompare from "shallow-compare"

class EnsureResources extends React.Component {
  constructor(props) {
    super()
    const { location, pageResources } = props
    this.state = {
      location: { ...location },
      pageResources:
        pageResources ||
        loader.loadPageSync(location.pathname + location.search, {
          withErrorDetails: true,
        }),
    }
  }

  static getDerivedStateFromProps({ location }, prevState) {
    if (prevState.location.href !== location.href) {
      const pageResources = loader.loadPageSync(
        location.pathname + location.search,
        {
          withErrorDetails: true,
        }
      )

      return {
        pageResources,
        location: { ...location },
      }
    }

    return {
      location: { ...location },
    }
  }

  loadResources(rawPath) {
    loader.loadPage(rawPath).then(pageResources => {
      if (pageResources && pageResources.status !== PageResourceStatus.Error) {
        this.setState({
          location: { ...window.location },
          pageResources,
        })
      } else {
        window.history.replaceState({}, ``, location.href)
        window.location = rawPath
      }
    })
  }

  shouldComponentUpdate(nextProps, nextState) {
    // リソースが不足している場合は常に false を返す。
    if (!nextState.pageResources) {
      this.loadResources(
        nextProps.location.pathname + nextProps.location.search
      )
      return false
    }

    if (
      process.env.BUILD_STAGE === `develop` &&
      nextState.pageResources.stale
    ) {
      this.loadResources(
        nextProps.location.pathname + nextProps.location.search
      )
      return false
    }

    // コンポーネントまたは JSON が変わったかどうかを確認する。
    if (this.state.pageResources !== nextState.pageResources) {
      return true
    }
    if (
      this.state.pageResources.component !== nextState.pageResources.component
    ) {
      return true
    }

    if (this.state.pageResources.json !== nextState.pageResources.json) {
      return true
    }
    // matchPath の設定による内部ルーティングを使うページで、
    // location が変わったかどうかを確認する。
    if (
      this.state.location.key !== nextState.location.key &&
      nextState.pageResources.page &&
      (nextState.pageResources.page.matchPath ||
        nextState.pageResources.page.path)
    ) {
      return true
    }
    return shallowCompare(this, nextProps, nextState)
  }

  render() {
    if (
      process.env.NODE_ENV !== `production` &&
      (!this.state.pageResources ||
        this.state.pageResources.status === PageResourceStatus.Error)
    ) {
      const message = `EnsureResources was not able to find resources for path: "${this.props.location.pathname}"
This typically means that an issue occurred building components for that path.
Run \`gatsby clean\` to remove any cached elements.`
      if (this.state.pageResources?.error) {
        console.error(message)
        throw this.state.pageResources.error
      }

      throw new Error(message)
    }

    return this.props.children(this.state)
  }
}

export default EnsureResources
