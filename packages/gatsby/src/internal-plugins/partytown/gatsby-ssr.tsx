import React from "react"
import { collectedScriptsByPage } from "gatsby-script"
import { getForwards } from "./utils/get-forwards"
import { partytownSnippet } from "@builder.io/partytown/integration"
import type { GatsbySSR } from "gatsby"

export const onRenderBody: GatsbySSR[`onRenderBody`] = ({
  pathname,
  setHeadComponents,
}) => {
  const collectedScripts = collectedScriptsByPage.get(pathname)

  if (!collectedScripts?.length) {
    return
  }

  const forwards = getForwards(collectedScripts)

  // https://github.com/BuilderIO/partytown/blob/main/src/react/snippet.tsx を基に、SSR のロジックだけを含むように改変したもの
  setHeadComponents([
    <script
      key="partytown"
      data-partytown=""
      suppressHydrationWarning={true}
      dangerouslySetInnerHTML={{
        __html: `
          ${partytownSnippet({ forward: forwards })}
          document.currentScript.dataset.partytown=""
        `,
      }}
    />,
  ])

  // 状態が漏れないように、使い終わったスクリプトを消去する
  collectedScriptsByPage.delete(pathname)
}
