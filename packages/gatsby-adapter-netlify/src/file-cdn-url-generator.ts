import { createHash } from "crypto"
import { basename } from "path"

import type { FileCdnUrlGeneratorFn, FileCdnSourceImage } from "gatsby"

function isImage(node: FileCdnSourceImage): boolean {
  return node.mimeType.startsWith(`image/`) && node.mimeType !== `image/svg+xml`
}

const placeholderOrigin = `http://netlify.com`

export const generateFileUrl: FileCdnUrlGeneratorFn = function generateFileUrl(
  source: FileCdnSourceImage,
  pathPrefix: string
): string {
  // 画像には image cdn を使い、その他のファイルには file lambda を使う
  let baseURL: URL
  if (isImage(source)) {
    baseURL = new URL(`${placeholderOrigin}/.netlify/images`)
    baseURL.searchParams.append(`url`, source.url)
    baseURL.searchParams.append(`cd`, source.internal.contentDigest)
  } else {
    baseURL = new URL(
      `${placeholderOrigin}${pathPrefix}/_gatsby/file/${createHash(`md5`)
        .update(source.url)
        .digest(`hex`)}/${basename(source.filename)}`
    )

    baseURL.searchParams.append(`url`, source.url)
    baseURL.searchParams.append(`cd`, source.internal.contentDigest)
  }

  return `${baseURL.pathname}${baseURL.search}`
}

export default generateFileUrl
