import * as React from "react"

export class ErrorBoundary extends React.Component {
  state = { error: null }

  componentDidCatch(error) {
    this.setState({ error })

    // コンポーネントのエラーを Fast Refresh のオーバーレイのシステムへ転送する
    if (
      window._gatsbyEvents &&
      typeof window._gatsbyEvents.push === `function`
    ) {
      window._gatsbyEvents.push([
        `FAST_REFRESH`,
        {
          action: `SHOW_RUNTIME_ERRORS`,
          payload: [error],
        },
      ])
    }
  }

  render() {
    // このチェックがないと無限ループになる可能性がある
    return this.state.error && this.props.hasErrors ? null : this.props.children
  }
}
