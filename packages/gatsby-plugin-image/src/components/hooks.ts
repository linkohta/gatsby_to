/* global GATSBY___IMAGE */
import { generateImageData, EVERY_BREAKPOINT } from "../image-utils"
import type { CSSProperties, HTMLAttributes, ImgHTMLAttributes } from "react"
import type { Node } from "gatsby"
import type { PlaceholderProps } from "./placeholder"
import type { MainImageProps } from "./main-image"
import type { IGatsbyImageData } from "./gatsby-image.browser"
import type {
  IGatsbyImageHelperArgs,
  Layout,
  IImage,
  ImageFormat,
} from "../image-utils"

// ネイティブの遅延読み込みへの対応: https://addyosmani.com/blog/lazy-loading/
export const hasNativeLazyLoadSupport = (): boolean =>
  typeof HTMLImageElement !== `undefined` &&
  `loading` in HTMLImageElement.prototype

export function gatsbyImageIsInstalled(): boolean {
  return typeof GATSBY___IMAGE !== `undefined` && GATSBY___IMAGE
}

export type IGatsbyImageDataParent<T = never> = T & {
  gatsbyImageData: IGatsbyImageData
}
export type IGatsbyImageParent<T = never> = T & {
  gatsbyImage: IGatsbyImageData
}
export type FileNode = Partial<Node> & {
  childImageSharp?: IGatsbyImageDataParent<Partial<Node>>
}

const isGatsbyImageData = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: IGatsbyImageData | any
): node is IGatsbyImageData =>
  // 🦆 深い階層の prop を調べ、有効な gatsbyImageData オブジェクトであることを確かめる
  Boolean(node?.images?.fallback?.src)

const isGatsbyImageDataParent = <T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: IGatsbyImageDataParent<T> | any
): node is IGatsbyImageDataParent<T> => Boolean(node?.gatsbyImageData)

const isGatsbyImageParent = <T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: IGatsbyImageParent<T> | any
): node is IGatsbyImageParent<T> => Boolean(node?.gatsbyImage)

export type ImageDataLike =
  | FileNode
  | IGatsbyImageDataParent
  | IGatsbyImageParent
  | IGatsbyImageData

export const getImage = (
  node: ImageDataLike | null
): IGatsbyImageData | undefined => {
  // gatsbyImageData と gatsbyImage の両方を確認する
  if (isGatsbyImageData(node)) {
    return node
  }
  // GraphQL の gatsbyImageData フィールド
  if (isGatsbyImageDataParent(node)) {
    return node.gatsbyImageData
  }
  // Gatsby の Image CDN サービス用の GraphQL の gatsbyImage フィールド
  if (isGatsbyImageParent(node)) {
    return node.gatsbyImage
  }
  return node?.childImageSharp?.gatsbyImageData
}

export const getSrc = (node: ImageDataLike): string | undefined =>
  getImage(node)?.images?.fallback?.src

export const getSrcSet = (node: ImageDataLike): string | undefined =>
  getImage(node)?.images?.fallback?.srcSet

export function getWrapperProps(
  width: number,
  height: number,
  layout: Layout
): Pick<HTMLAttributes<HTMLElement>, "className" | "style"> & {
  "data-gatsby-image-wrapper": string
} {
  const wrapperStyle: CSSProperties = {}

  let className = `gatsby-image-wrapper`

  // プラグインがインストールされていない場合は、スタイルをインラインで適用する必要がある
  if (!gatsbyImageIsInstalled()) {
    wrapperStyle.position = `relative`
    wrapperStyle.overflow = `hidden`
  }

  if (layout === `fixed`) {
    wrapperStyle.width = width
    wrapperStyle.height = height
  } else if (layout === `constrained`) {
    if (!gatsbyImageIsInstalled()) {
      wrapperStyle.display = `inline-block`
      wrapperStyle.verticalAlign = `top`
    }
    className = `gatsby-image-wrapper gatsby-image-wrapper-constrained`
  }

  return {
    className,
    "data-gatsby-image-wrapper": ``,
    style: wrapperStyle,
  }
}

export interface IUrlBuilderArgs<OptionsType> {
  width: number
  height: number
  baseUrl: string
  format: ImageFormat
  options: OptionsType
}
export interface IGetImageDataArgs<OptionsType = Record<string, unknown>> {
  baseUrl: string
  /**
   * constrained と fixed の画像での、画像要素のサイズ
   */
  width?: number
  height?: number
  /**
   * 分かる場合は、元画像の幅と高さを渡す
   */
  sourceWidth?: number
  sourceHeight?: number
  /**
   * 片方の寸法だけを渡した場合は、それを使ってもう片方を計算する。
   */
  aspectRatio?: number
  layout?: Layout
  /**
   * 渡された引数をもとに URL を返す。純粋関数であること
   */
  urlBuilder: (args: IUrlBuilderArgs<OptionsType>) => string

  /**
   * data URI であること
   */
  placeholderURL?: string
  backgroundColor?: string
  /**
   * エラーメッセージなどで使う
   */
  pluginName?: string

  /**
   * フォーマットの自動選択に対応していない場合は、ここに画像の種類の配列を渡す
   */
  formats?: Array<ImageFormat>

  breakpoints?: Array<number>

  /**
   * urlBuilder 関数に渡される
   */
  options?: OptionsType
}

/**
 * ブラウザで gatsby-plugin-image のデータを生成するには、このフックを使う。
 */
export function getImageData<OptionsType>({
  baseUrl,
  urlBuilder,
  sourceWidth,
  sourceHeight,
  pluginName = `getImageData`,
  formats = [`auto`],
  breakpoints,
  options,
  ...props
}: IGetImageDataArgs<OptionsType>): IGatsbyImageData {
  if (
    !breakpoints?.length &&
    (props.layout === `fullWidth` || (props.layout as string) === `FULL_WIDTH`)
  ) {
    breakpoints = EVERY_BREAKPOINT
  }
  const generateImageSource = (
    baseUrl: string,
    width: number,
    height?: number,
    format?: ImageFormat
  ): IImage => {
    return {
      width,
      height,
      format,
      src: urlBuilder({ baseUrl, width, height, options, format }),
    }
  }

  const sourceMetadata: IGatsbyImageHelperArgs["sourceMetadata"] = {
    width: sourceWidth,
    height: sourceHeight,
    format: `auto`,
  }

  const args: IGatsbyImageHelperArgs = {
    ...props,
    pluginName,
    generateImageSource,
    filename: baseUrl,
    formats,
    breakpoints,
    sourceMetadata,
  }
  return generateImageData(args)
}

export function getMainProps(
  isLoading: boolean,
  isLoaded: boolean,
  images: IGatsbyImageData["images"],
  loading?: "eager" | "lazy",
  style: CSSProperties = {}
): Partial<MainImageProps> {
  // gatsby-config で設定されていない場合のフォールバック。
  if (!gatsbyImageIsInstalled()) {
    style = {
      height: `100%`,
      left: 0,
      position: `absolute`,
      top: 0,
      transform: `translateZ(0)`,
      transition: `opacity 250ms linear`,
      width: `100%`,
      willChange: `opacity`,
      ...style,
    }
  }

  const result = {
    ...images,
    loading,
    shouldLoad: isLoading,
    "data-main-image": ``,
    style: {
      ...style,
      opacity: isLoaded ? 1 : 0,
    },
  }

  return result
}

export type PlaceholderImageAttrs = ImgHTMLAttributes<HTMLImageElement> &
  Pick<PlaceholderProps, "sources" | "fallback"> & {
    "data-placeholder-image"?: string
  }

export function getPlaceholderProps(
  placeholder: PlaceholderImageAttrs | undefined,
  isLoaded: boolean,
  layout: Layout,
  width?: number,
  height?: number,
  backgroundColor?: string,
  objectFit?: CSSProperties["objectFit"],
  objectPosition?: CSSProperties["objectPosition"]
): PlaceholderImageAttrs {
  const wrapperStyle: CSSProperties = {}

  if (backgroundColor) {
    wrapperStyle.backgroundColor = backgroundColor

    if (layout === `fixed`) {
      wrapperStyle.width = width
      wrapperStyle.height = height
      wrapperStyle.backgroundColor = backgroundColor
      wrapperStyle.position = `relative`
    } else if (layout === `constrained`) {
      wrapperStyle.position = `absolute`
      wrapperStyle.top = 0
      wrapperStyle.left = 0
      wrapperStyle.bottom = 0
      wrapperStyle.right = 0
    } else if (layout === `fullWidth`) {
      wrapperStyle.position = `absolute`
      wrapperStyle.top = 0
      wrapperStyle.left = 0
      wrapperStyle.bottom = 0
      wrapperStyle.right = 0
    }
  }

  if (objectFit) {
    wrapperStyle.objectFit = objectFit
  }

  if (objectPosition) {
    wrapperStyle.objectPosition = objectPosition
  }
  const result: PlaceholderImageAttrs = {
    ...placeholder,
    "aria-hidden": true,
    "data-placeholder-image": ``,
    style: {
      opacity: isLoaded ? 0 : 1,
      transition: `opacity 500ms linear`,
      ...wrapperStyle,
    },
  }

  // gatsby-config で設定されていない場合のフォールバック。
  if (!gatsbyImageIsInstalled()) {
    result.style = {
      height: `100%`,
      left: 0,
      position: `absolute`,
      top: 0,
      width: `100%`,
    }
  }

  return result
}

export interface IArtDirectedImage {
  media: string
  image: IGatsbyImageData
}

/**
 * 異なる解像度で表示する、アートディレクション用の複数の画像を持つ Gatsby の画像データオブジェクトを
 * 生成する。
 *
 * @param defaultImage どのメディアクエリにも一致しないときに表示する画像。
 * 幅、高さ、レイアウトなど、画像に適用するその他すべての設定にも使われる。
 * コンテナのサイズは自動では調整できないため、メディアクエリを含む className を
 * コンポーネントに渡して調整すること。
 * @param artDirected オブジェクトの配列。各オブジェクトは、メディアクエリの文字列 `media`
 * （`(min-width: 320px)` など）と、そのクエリに一致したときに使う画像オブジェクトを持つ。
 */
export function withArtDirection(
  defaultImage: IGatsbyImageData,
  artDirected: Array<IArtDirectedImage>
): IGatsbyImageData {
  const { images, placeholder, ...props } = defaultImage
  const output: IGatsbyImageData = {
    ...props,
    images: {
      ...images,
      sources: [],
    },
    placeholder: placeholder && {
      ...placeholder,
      sources: [],
    },
  }

  artDirected.forEach(({ media, image }) => {
    if (!media) {
      if (process.env.NODE_ENV === `development`) {
        console.warn(
          "[gatsby-plugin-image] All art-directed images passed to must have a value set for `media`. Skipping."
        )
      }
      return
    }

    if (
      image.layout !== defaultImage.layout &&
      process.env.NODE_ENV === `development`
    ) {
      console.warn(
        `[gatsby-plugin-image] Mismatched image layout: expected "${defaultImage.layout}" but received "${image.layout}". All art-directed images use the same layout as the default image`
      )
    }

    output.images.sources.push(
      ...image.images.sources.map(source => {
        return { ...source, media }
      }),
      {
        media,
        srcSet: image.images.fallback.srcSet,
      }
    )

    if (!output.placeholder) {
      return
    }

    output.placeholder.sources.push({
      media,
      srcSet: image.placeholder.fallback,
    })
  })
  output.images.sources.push(...images.sources)
  if (placeholder?.sources) {
    output.placeholder?.sources.push(...placeholder.sources)
  }
  return output
}
