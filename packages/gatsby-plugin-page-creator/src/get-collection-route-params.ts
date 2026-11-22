import { extractFieldWithoutUnion, removeFileExtension } from "./path-utils"

// 対応する filePath から params を取り出し、
// 一致したものをオブジェクトで返す。
// 例: /foo/{Product.id}, /foo/123 => {id: 123}
export function getCollectionRouteParams(
  urlTemplate: string,
  urlPath: string
): Record<string, string> {
  const params = {}

  // urlTemplate と urlPath が同じ形になるよう、先にファイルの拡張子を取り除く
  const cleanedUrlTemplate = removeFileExtension(urlTemplate)
  const urlTemplateParts = cleanedUrlTemplate.split(`/`)
  // 見つかったすべての { } をグループにして、後で使う正規表現の文字列を作成する
  // 例: /foo/prefix-{Product.id} => /foo/prefix-(.+)
  const templateRegex = cleanedUrlTemplate
    .replace(/\./g, `\\.`) // ドットをエスケープする
    .replace(/(\{.*?\})/g, `(.+)`)
    .split(`/`)
  const urlParts = urlPath.split(`/`)

  urlTemplateParts.forEach((part, i) => {
    if (!part.includes(`{`) || !part.includes(`}`)) {
      return
    }
    // 先ほど作成した正規表現を使って、prefix-123 を prefix-(.+) に一致させる
    const match = urlParts[i]?.match(templateRegex[i])

    if (!match) {
      return
    }

    const keys = extractFieldWithoutUnion(part)

    keys.some((k, j) => {
      params[k] = match[j + 1]

      return !match
    })
  })

  return params
}
