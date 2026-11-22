import * as React from "react"
import { ShadowPortal } from "../shadow-portal"
import { Style } from "./style"
import { isLoadingIndicatorEnabled } from "$virtual/loading-indicator"
import { debugLog } from "../debug-log"

if (typeof window === `undefined`) {
  throw new Error(
    `Loading indicator should never be imported in code that doesn't target only browsers`
  )
}

if (module.hot) {
  module.hot.accept(`$virtual/loading-indicator`, () => {
    // isLoadingIndicatorEnabled は ES の import で読み込んでいるので、専用の処理は不要である。
    // その場合は HMR が単に置き換える
  })
}

// HMR によってこれが再実行されることがあるので、すでに設定済みかを確認する
// HMR はモジュールスコープをリセットするので、モジュールスコープだけでなく
// window にも設定する
if (typeof window.___gatsbyDidShowLoadingIndicatorBefore === `undefined`) {
  window.___gatsbyDidShowLoadingIndicatorBefore = false
}

export function Indicator({ visible = true }) {
  if (!isLoadingIndicatorEnabled()) {
    return null
  }

  if (!window.___gatsbyDidShowLoadingIndicatorBefore) {
    // render 関数の中でこれを行うのは理想的ではないが、コンソールへの情報出力にすぎない
    debugLog(
      `A loading indicator is displayed in-browser whenever content is being requested upon navigation (Query On Demand).\n\nYou can disable the loading indicator for your current session by visiting ${window.location.origin}/___loading-indicator/disable`
    )
    window.___gatsbyDidShowLoadingIndicatorBefore = true
  }

  return (
    <ShadowPortal identifier="gatsby-qod">
      <Style />
      <div
        data-gatsby-loading-indicator="root"
        // preact は、値がリテラルの false である data 属性を DOM にレンダリングしない
        data-gatsby-loading-indicator-visible={visible.toString()}
        aria-live="assertive"
      >
        <div data-gatsby-loading-indicator="spinner" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M0 0h24v24H0z" fill="none" />
            <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z" />
          </svg>
        </div>
        <div data-gatsby-loading-indicator="text">
          {visible ? `Preparing requested page` : ``}
        </div>
      </div>
    </ShadowPortal>
  )
}
