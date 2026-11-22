import { ReactNode } from "react"
import { Options } from "@contentful/rich-text-react-renderer"

interface ContentfulRichTextGatsbyReference {
  /**
   * アセットの場合は ContentfulAsset、コンテンツタイプの場合は ContentfulYourContentTypeName
   */
  __typename: string
  contentful_id: string
}

interface RenderRichTextData<T extends ContentfulRichTextGatsbyReference> {
  raw?: string | null
  references?: T[] | null
}

export function renderRichText<
  TReference extends ContentfulRichTextGatsbyReference
>(data: RenderRichTextData<TReference>, options?: Options): ReactNode
