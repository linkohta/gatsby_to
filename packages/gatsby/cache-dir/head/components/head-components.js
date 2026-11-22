import React from "react"

import {
  HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY,
  ITEM_PROP_WORKAROUND_KEY,
  ITEM_PROP_WORKAROUND_VALUE,
  VALID_NODE_NAMES,
} from "../constants"

export const IsHeadRenderContext = React.createContext(false)

export function getValidHeadComponentReplacements(
  originalCreateElement,
  forceHeadRenderContext
) {
  function useIsHeadRender() {
    if (forceHeadRenderContext) {
      // SSR では head のレンダリングが同期的なので、React のコンテキストを使う必要はない
      // そのため、強制するほうがパフォーマンスがよい
      return true
    }

    // ブラウザーでは React のコンテキストを使う
    // 注: 厳密にはフックのルールに違反している。条件付きのコードが実行された後で、
    // フックの先頭ではない位置で useContext を使っているためである。
    // ただし、これが問題になるのは `forceHeadRenderContext` が再レンダリングの間に変わりうる場合だけであり、
    // これはファクトリーの引数なので変わることはない
    const isHeadRenderFromContext = React.useContext(IsHeadRenderContext)

    return isHeadRenderFromContext
  }

  function htmlOrBodyComponentFactory(TagName) {
    const HeadAwareComponent = props => {
      // モンキーパッチのリスクを下げるため、`Head()` のレンダリング中にだけ適用する。
      const isHeadRender = useIsHeadRender()
      if (isHeadRender) {
        const allProps = {
          ...props,
          [HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY]: TagName,
        }
        return originalCreateElement(`div`, allProps)
      } else {
        return originalCreateElement(TagName, props)
      }
    }
    HeadAwareComponent.displayName = `React19HeadAPICompat${TagName}`
    return HeadAwareComponent
  }

  function nodeComponentFactory(TagName) {
    const HeadAwareComponent = props => {
      // モンキーパッチのリスクを下げるため、`Head()` のレンダリング中にだけ適用する:
      const isHeadRender = useIsHeadRender()
      // props に ITEM_PROP_WORKAROUND_KEY が設定されていない場合にだけ props を変更する
      if (isHeadRender && !(ITEM_PROP_WORKAROUND_KEY in props)) {
        const propsWithWorkaround = {
          ...props,
          [ITEM_PROP_WORKAROUND_KEY]: ITEM_PROP_WORKAROUND_VALUE,
        }
        return originalCreateElement(TagName, propsWithWorkaround)
      }

      return originalCreateElement(TagName, props)
    }
    HeadAwareComponent.displayName = `React19HeadAPICompat${TagName}`
    return HeadAwareComponent
  }

  return new Map(
    VALID_NODE_NAMES.map(nodeName => {
      // 有効な head のノードごとに、置き換え用のコンポーネントを作成する。
      // このコンポーネントは IsHeadRenderContext コンテキストを確認でき
      // （新しいコンポーネントなのでフックのルールには違反しない）、
      // React 19 による meta タグの自動処理への回避策を適用する。
      // この自動処理は Gatsby の Head API と互換性がない

      const replacement =
        nodeName === `html` || nodeName === `body`
          ? htmlOrBodyComponentFactory(nodeName)
          : nodeComponentFactory(nodeName)

      return [nodeName, replacement]
    })
  )
}
