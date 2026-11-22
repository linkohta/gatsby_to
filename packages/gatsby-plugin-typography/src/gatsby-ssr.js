import React from "react"
import { TypographyStyle, GoogleFont } from "react-typography"
import typography from "typography-plugin-cache-endpoint"

exports.onRenderBody = ({ setHeadComponents }, pluginOptions) => {
  const googleFont = [].concat(
    pluginOptions.omitGoogleFont ? (
      []
    ) : (
      <GoogleFont key={`GoogleFont`} typography={typography} />
    )
  )
  setHeadComponents([
    <TypographyStyle key={`TypographyStyle`} typography={typography} />,
    ...googleFont,
  ])
}

// Typography.js のスタイルを head セクションの先頭へ移動し、最初に読み込まれて
// 他のスタイルを誤って上書きしないようにする。Typography.js は
// 設定可能な CSS リセットとして作られているので、常に最初に読み込むべきである。
exports.onPreRenderHTML = ({ getHeadComponents, replaceHeadComponents }) => {
  const headComponents = getHeadComponents()
  headComponents.sort((x, y) => {
    if (x && x.key === `TypographyStyle`) {
      return -1
    } else if (y && y.key === `TypographyStyle`) {
      return 1
    }
    return 0
  })
  replaceHeadComponents(headComponents)
}
