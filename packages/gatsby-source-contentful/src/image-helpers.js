// @ts-check
import { URLSearchParams } from "url"

// Contentful Image API のサイズパラメーターの最大値
// @see https://www.contentful.com/developers/docs/references/images-api/#/reference/resizing-&-cropping/specify-width-&-height
export const CONTENTFUL_IMAGE_MAX_SIZE = 4000

// Contentful Image API が対応している画像フォーマット (https://www.contentful.com/developers/docs/references/images-api/#/reference/changing-formats/image-format)
export const validImageFormats = new Set([`jpg`, `png`, `webp`, `gif`, `avif`])

// MIME タイプから適切なファイル拡張子を決める
export const mimeTypeExtensions = new Map([
  [`image/jpeg`, `.jpg`],
  [`image/jpg`, `.jpg`],
  [`image/gif`, `.gif`],
  [`image/png`, `.png`],
  [`image/webp`, `.webp`],
  [`image/avif`, `.avif`],
])

// Contentful のアセットが実際に画像かどうかを確認する
export function isImage(image) {
  return mimeTypeExtensions.has(image?.file?.contentType)
}

// Contentful Image API の URL を作成する
export function createUrl(imgUrl, options = {}) {
  // radius が -1 の場合は、API に `max` を渡す必要がある
  const cornerRadius =
    options.cornerRadius === -1 ? `max` : options.cornerRadius

  if (options.toFormat === `auto`) {
    delete options.toFormat
  }

  // Contentful の名前に変換し、undefined/null の値を取り除く。
  const urlArgs = {
    w: options.width || undefined,
    h: options.height || undefined,
    fl:
      options.toFormat === `jpg` && options.jpegProgressive
        ? `progressive`
        : undefined,
    q: options.quality || undefined,
    fm: options.toFormat || undefined,
    fit: options.resizingBehavior || undefined,
    f: options.cropFocus || undefined,
    bg: options.background || undefined,
    r: cornerRadius || undefined,
  }

  const isBrowser = typeof window !== `undefined`

  const searchParams = isBrowser
    ? new window.URLSearchParams()
    : new URLSearchParams()

  for (const paramKey in urlArgs) {
    if (typeof urlArgs[paramKey] !== `undefined`) {
      searchParams.append(paramKey, urlArgs[paramKey] ?? ``)
    }
  }

  return `https:${imgUrl}?${searchParams.toString()}`
}
