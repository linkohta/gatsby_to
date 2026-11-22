import * as React from "react"
import { withPrefix as fallbackWithPrefix, withAssetPrefix } from "gatsby"
import { posix } from "path"

// TODO: v3 で削除する - 不安定なパスとアセットのプレフィックス処理を修正する
const withPrefix = withAssetPrefix || fallbackWithPrefix

exports.onRenderBody = ({ setHeadComponents }, pluginOptions) => {
  const { output, createLinkInHead } = pluginOptions

  if (!createLinkInHead) {
    return
  }

  setHeadComponents([
    <link
      key={`gatsby-plugin-sitemap`}
      rel="sitemap"
      type="application/xml"
      href={withPrefix(posix.join(output, `/sitemap-index.xml`))}
    />,
  ])
}
