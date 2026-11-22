import React from "react"
import { useEffect } from "react"
import { StaticQueryContext } from "gatsby"
import { LocationProvider } from "@gatsbyjs/reach-router"

import { reactDOMUtils } from "../react-dom-utils"
import { FireCallbackInEffect } from "./components/fire-callback-in-effect"
import {
  IsHeadRenderContext,
  getValidHeadComponentReplacements,
} from "./components/head-components"
import {
  headExportValidator,
  filterHeadProps,
  diffNodes,
  getValidHeadNodesAndAttributes,
  removePrevHeadElements,
  applyHtmlAndBodyAttributes,
  removeHtmlAndBodyAttributes,
} from "./utils"
import { apiRunner } from "../api-runner-browser"

const hiddenRoot = document.createElement(`div`)
const keysOfHtmlAndBodyAttributes = {
  html: [],
  body: [],
}

const onHeadRendered = () => {
  const { validHeadNodes, htmlAndBodyAttributes } =
    getValidHeadNodesAndAttributes(hiddenRoot)

  keysOfHtmlAndBodyAttributes.html = Object.keys(htmlAndBodyAttributes.html)
  keysOfHtmlAndBodyAttributes.body = Object.keys(htmlAndBodyAttributes.body)

  applyHtmlAndBodyAttributes(htmlAndBodyAttributes)

  /**
   * 以下のコードブロックの残りは、再レンダリングのたびに head の要素が
   * 重複しないようにするための差分検出の仕組みである。
   */
  const existingHeadElements = document.querySelectorAll(`[data-gatsby-head]`)

  if (existingHeadElements.length === 0) {
    document.head.append(...validHeadNodes)
    return
  }

  const newHeadNodes = []
  diffNodes({
    oldNodes: existingHeadElements,
    newNodes: validHeadNodes,
    onStale: node => node.parentNode.removeChild(node),
    onNew: node => newHeadNodes.push(node),
  })

  document.head.append(...newHeadNodes)
}

if (process.env.BUILD_STAGE === `develop`) {
  // やれやれ ... <html> と <body> の要素は <div>（非表示の要素）の子孫としては無効である
  // dev モードの react-dom はこれについて警告する。この問題に当たらずに、ユーザーの任意の Head を
  // レンダリングする方法はなさそうだ（非表示の要素を単に "new Document()" にすることもできるが、
  // 子を 1 つしか持てず、何がレンダリングされるかはこちらで制御できないので選択肢にならない）
  // そのため、引き続き <div> にレンダリングし、<html> と <body> の要素に対する警告だけを抑制する
  // https://github.com/facebook/react/blob/e2424f33b3ad727321fc12e75c5e94838e84c2b5/packages/react-dom-bindings/src/client/validateDOMNesting.js#L498-L520
  const originalConsoleError = console.error.bind(console)
  console.error = (...args) => {
    if (
      Array.isArray(args) &&
      args.length >= 2 &&
      args[0]?.includes?.(`validateDOMNesting(...): %s cannot appear as`) &&
      (args[1] === `<html>` || args[1] === `<body>`)
    ) {
      return undefined
    }
    return originalConsoleError(...args)
  }

  /* react-refresh が非表示の要素を更新した後に <head> を再生成できるよう、
     オブザーバーを設定する。
  */
  const observer = new MutationObserver(onHeadRendered)
  observer.observe(hiddenRoot, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  })
}

// React 19 では、ツリー内のどこであっても 2 つ目の `<html>` や `<body>` をレンダリングできない:
// https://github.com/facebook/react/blob/50e7ec8a694072fd6fcd52182df8a75211bf084d/packages/react-dom-bindings/src/server/ReactFizzConfigDOM.js#L3739
// 残念ながら、Head API はユーザーがこれらの要素をレンダリングできることに依存している。
// それらを非表示の `<div>` にレンダリングし、本物の `<html>` と `<body>` に適用する属性を取り出している。
// いくつかの代替案を検討したが、React の制約のもとで実現できるものはなかった。
// これを回避するため、Head の中でこれらの要素をレンダリングしようとする処理を横取りし、
// `data-original-tag` 属性を持つ `<div>` としてレンダリングされる
// 独自のコンポーネントに置き換える。後でこの属性を使って、
// 本物の `<html>` と `<body>` の要素に属性を適用できる。
// さらに、他の head の要素は React の新しい巻き上げ（hoisting）の対象になる。
// これは Gatsby の Head API の動作といくつか違いがあるため、`itemProp` を追加して
// React がそれらの要素を巻き上げないようにしている:
// https://github.com/facebook/react/blob/50e7ec8a694072fd6fcd52182df8a75211bf084d/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L5824
// この属性が独自の値を持っている場合は、本物の head に追加する前に取り除く。

// モンキーパッチのリスクを下げるため、必要な場合（React 18 ではなく React 19 以降）にだけ適用する
const reactMajor = parseInt(React.version.split(`.`)[0], 10)
if (reactMajor !== 18 && !React.createElement.headPatched) {
  const originalCreateElement = React.createElement
  const validHeadComponentReplacements = getValidHeadComponentReplacements(
    originalCreateElement,
    false
  )
  React.createElement = function patchedCreateElement(type, props, ...rest) {
    const headReplacement = validHeadComponentReplacements.get(type)
    if (headReplacement) {
      type = headReplacement
    }

    return originalCreateElement.call(React, type, props, ...rest)
  }

  React.createElement.headPatched = true
}
export function headHandlerForBrowser({
  pageComponent,
  staticQueryResults,
  pageComponentProps,
}) {
  useEffect(() => {
    if (pageComponent?.Head) {
      headExportValidator(pageComponent.Head)

      const { render } = reactDOMUtils()

      const HeadElement = (
        <pageComponent.Head {...filterHeadProps(pageComponentProps)} />
      )

      const WrapHeadElement = apiRunner(
        `wrapRootElement`,
        { element: HeadElement },
        HeadElement,
        ({ result }) => {
          return { element: result }
        }
      ).pop()

      render(
        // React が最初のレンダリングを終えた後にコールバックを呼ぶためのハック
        // 注: 開発時は onHeadRendered を 2 回呼ぶ（FireCallbackInEffect の中と、MutationObserver が hiddenRoot への最初のレンダリングを検知した後）。これはホットリロードのためである
        // 本番では、head へレンダリングするために FireCallbackInEffect の中でだけ onHeadRendered を呼ぶ
        <FireCallbackInEffect callback={onHeadRendered}>
          <IsHeadRenderContext.Provider value={true}>
            <StaticQueryContext.Provider value={staticQueryResults}>
              <LocationProvider>{WrapHeadElement}</LocationProvider>
            </StaticQueryContext.Provider>
          </IsHeadRenderContext.Provider>
        </FireCallbackInEffect>,
        hiddenRoot
      )
    }

    return () => {
      removePrevHeadElements()
      removeHtmlAndBodyAttributes(keysOfHtmlAndBodyAttributes)
    }
  })
}
