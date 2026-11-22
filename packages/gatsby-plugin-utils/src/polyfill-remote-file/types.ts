import type { Node, GatsbyNode, NodeInput } from "gatsby"

interface IRemoteFileNodeFields {
  url: string
  mimeType: string
  filename: string
  filesize?: number
}

export interface IRemoteFileNode extends IRemoteFileNodeFields, Node {}

export interface IRemoteFileNodeInput
  extends IRemoteFileNodeFields,
    NodeInput {}

interface IRemoteImageNodeFields {
  width: number
  height: number
  placeholderUrl?: string
}

export interface IRemoteImageNode
  extends IRemoteImageNodeFields,
    IRemoteFileNode {}

export interface IRemoteImageNodeInput
  extends IRemoteImageNodeFields,
    IRemoteFileNodeInput {}

type GraphqlType<T> = T extends number
  ? "Int" | "Float"
  : T extends boolean
  ? "Boolean"
  : string

export interface IGraphQLFieldConfigDefinition<
  TSource,
  R,
  TArgs = Record<string, unknown>
> {
  type: string
  description?: string
  args?: {
    [Property in keyof TArgs]:
      | GraphqlType<TArgs[Property]>
      | {
          type: GraphqlType<TArgs[Property]>
          description?: string
          defaultValue?: TArgs[Property]
        }
  }
  resolve(source: TSource, args: TArgs): R
}

export type SchemaBuilder = Parameters<
  NonNullable<GatsbyNode["createSchemaCustomization"]>
>[0]["schema"]

export type ImageFit = import("sharp").FitEnum[keyof import("sharp").FitEnum]
export type ImageFormat = "jpg" | "png" | "webp" | "avif" | "auto"
export type ImageLayout = "fixed" | "constrained" | "fullWidth"
export type ImageCropFocus =
  | "center"
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "entropy"
  | "edges"
  | "faces"

export type WidthOrHeight =
  | { width: number; height: number }
  | { width: number; height?: never }
  | { width?: never; height: number }

export type CalculateImageSizesArgs = {
  fit: ImageFit
  layout: ImageLayout
  outputPixelDensities: Array<number>
  breakpoints?: Array<number>
  aspectRatio?: number
} & WidthOrHeight

export function isImage(node: {
  mimeType: IRemoteFileNode["mimeType"]
}): node is IRemoteImageNode {
  if (!node.mimeType) {
    throw new Error(
      `RemoteFileNode does not have a mimeType. The field is required.`
    )
  }

  return node.mimeType.startsWith(`image/`) && node.mimeType !== `image/svg+xml`
}

export type ImageCdnTransformArgs = WidthOrHeight & {
  format: string
  cropFocus?: ImageCropFocus | Array<ImageCropFocus>
  quality: number
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type CdnSourceImage = {
  url: string
  mimeType: string
  filename: string
  internal: { contentDigest: string }
}

export type ImageCdnSourceImage = CdnSourceImage

/**
 * この関数は、CDN の機能を活用する URL を生成して、画像の配信を最適化するために使う
 * @param {ImageCdnSourceImage} source - 元画像を表すオブジェクト。URL、ファイル名、
 * MIME タイプなどのプロパティを持つ。
 * @param {ImageCdnTransformArgs} imageArgs - 画像変換の引数を持つオブジェクト。フォーマット、
 * 品質、クロップの基準位置など。
 * @param {string} pathPrefix - 生成する相対 URL に付ける任意のパスプレフィックス。
 * 主に画像変換のエンドポイントの場所に影響し、特にドメインのルートにない場合に関係する。
 * @returns {string} CDN 上の画像を指す、生成された URL の文字列。相対 URL が望ましいが
 * （`/` で始まり、サイト自身と同じドメインが使われる）、絶対 URL でもよい。
 */
export type ImageCdnUrlGeneratorFn = (
  source: ImageCdnSourceImage,
  imageArgs: ImageCdnTransformArgs,
  pathPrefix: string
) => string

export type FileCdnSourceImage = CdnSourceImage

/**
 * この関数は、CDN の機能を活用する URL を生成して、画像の配信を最適化するために使う
 * @param {FileCdnSourceImage} source - 元ファイルを表すオブジェクト。URL、ファイル名、
 * MIME タイプなどのプロパティを持つ。
 * @param {string} pathPrefix - 生成する URL の前に付けるパスプレフィックスを表す
 * 文字列。
 * @returns {string} CDN 上のファイルを指す、生成された URL の文字列。相対 URL が望ましいが
 * （`/` で始まり、サイト自身と同じドメインが使われる）、絶対 URL でもよい。
 */
export type FileCdnUrlGeneratorFn = (
  source: FileCdnSourceImage,
  pathPrefix: string
) => string
