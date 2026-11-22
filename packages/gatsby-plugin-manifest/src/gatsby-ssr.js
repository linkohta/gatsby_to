import * as React from "react"
import { withPrefix as fallbackWithPrefix, withAssetPrefix } from "gatsby"
import { defaultIcons, addDigestToPath, favicons } from "./common.js"
import getManifestForPathname from "./get-manifest-pathname"

// TODO: v3 で削除する
const withPrefix = withAssetPrefix || fallbackWithPrefix

exports.onRenderBody = (
  { setHeadComponents, pathname = `/` },
  {
    localize,
    legacy,
    cache_busting_mode: cacheBusting,
    cacheDigest,
    icon,
    icons: pluginIcons,
    include_favicon: insertFaviconLinkTag,
    theme_color_in_head: insertMetaTag,
    theme_color: themeColor,
    crossOrigin = `anonymous`,
  }
) => {
  // onRenderBody の最後に setHeadComponents の引数として渡す、最終的な配列を組み立てるために使う。
  const headComponents = []

  const srcIconExists = !!icon
  const icons = pluginIcons || defaultIcons
  const manifestFileName = getManifestForPathname(pathname, localize)

  // アイコンが生成されていれば、favicon の link も追加する。
  if (srcIconExists) {
    if (insertFaviconLinkTag) {
      favicons.forEach(favicon => {
        headComponents.push(
          <link
            key={`gatsby-plugin-manifest-icon-link-png`}
            rel="icon"
            href={withPrefix(
              addDigestToPath(favicon.src, cacheDigest, cacheBusting)
            )}
            type="image/png"
          />
        )
      })
      if (icon?.endsWith(`.svg`)) {
        headComponents.push(
          <link
            key={`gatsby-plugin-manifest-icon-link-svg`}
            rel="icon"
            href={withPrefix(
              addDigestToPath(`favicon.svg`, cacheDigest, cacheBusting)
            )}
            type="image/svg+xml"
          />
        )
      }
    }
  }

  // manifest の link タグを追加する。
  headComponents.push(
    <link
      key={`gatsby-plugin-manifest-link`}
      rel="manifest"
      href={fallbackWithPrefix(`/${manifestFileName}`)}
      crossOrigin={crossOrigin}
    />
  )

  // ユーザーは、head への theme_color の meta タグの挿入を無効にできる。
  if (themeColor && insertMetaTag) {
    headComponents.push(
      <meta
        key={`gatsby-plugin-manifest-meta`}
        name="theme-color"
        content={themeColor}
      />
    )
  }

  if (legacy) {
    icons.forEach(icon => {
      headComponents.push(
        <link
          key={`gatsby-plugin-manifest-apple-touch-icon-${icon.sizes}`}
          rel="apple-touch-icon"
          sizes={icon.sizes}
          href={withPrefix(
            addDigestToPath(
              icon.src,
              cacheDigest,
              srcIconExists ? cacheBusting : `none`
            )
          )}
        />
      )
    })
  }

  setHeadComponents(headComponents)

  return true
}
