// @ts-check
import { documentToReactComponents } from "@contentful/rich-text-react-renderer"
import resolveResponse from "contentful-resolve-response"

export function renderRichText({ raw, references }, options = {}) {
  const richText = JSON.parse(raw || null)

  // 参照が渡されていなければ、解決する必要はない
  if (!references || !references.length) {
    return documentToReactComponents(richText, options)
  }

  // エントリーの解決に公式ライブラリを使えるよう、ダミーのレスポンスを作成する
  const dummyResponse = {
    items: [
      {
        sys: { type: `Entry` },
        richText,
      },
    ],
    includes: {
      Entry: references
        .filter(({ __typename }) => __typename !== `ContentfulAsset`)
        .map(reference => {
          return {
            ...reference,
            sys: { type: `Entry`, id: reference.contentful_id },
          }
        }),
      Asset: references
        .filter(({ __typename }) => __typename === `ContentfulAsset`)
        .map(reference => {
          return {
            ...reference,
            sys: { type: `Asset`, id: reference.contentful_id },
          }
        }),
    },
  }

  const resolved = resolveResponse(dummyResponse, {
    removeUnresolved: true,
  })

  return documentToReactComponents(resolved[0].richText, options)
}
