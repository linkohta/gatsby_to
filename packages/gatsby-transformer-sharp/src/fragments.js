/* eslint-disable */
import { graphql } from "gatsby"

/**
 * fixed の sharp 画像用の、最も単純なフィールド一式
 * @type {Fragment}
 * @example
 * childImageSharp {
 *   fixed {
 *     ...GatsbyImageSharpFixed
 *     # ^ identical to using the following fields:
 *     # base64
 *     # width
 *     # height
 *     # src
 *     # srcSet
 *   }
 * }
 */
export const GatsbyImageSharpFixed = graphql`
  fragment GatsbyImageSharpFixed on ImageSharpFixed {
    base64
    width
    height
    src
    srcSet
  }
`

/**
 * トレースした SVG を使う fixed の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFixed_tracedSVG = graphql`
  fragment GatsbyImageSharpFixed_tracedSVG on ImageSharpFixed {
    tracedSVG
    width
    height
    src
    srcSet
  }
`

/**
 * fixed の画像に Webp を使う画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFixed_withWebp = graphql`
  fragment GatsbyImageSharpFixed_withWebp on ImageSharpFixed {
    base64
    width
    height
    src
    srcSet
    srcWebp
    srcSetWebp
  }
`

/**
 * fixed の画像に Webp を使い、トレースした SVG を使う画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFixed_withWebp_tracedSVG = graphql`
  fragment GatsbyImageSharpFixed_withWebp_tracedSVG on ImageSharpFixed {
    tracedSVG
    width
    height
    src
    srcSet
    srcWebp
    srcSetWebp
  }
`

/**
 * ぼかした base64 画像を含まない fixed の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFixed_noBase64 = graphql`
  fragment GatsbyImageSharpFixed_noBase64 on ImageSharpFixed {
    width
    height
    src
    srcSet
  }
`

/**
 * ぼかした base64 画像を含まず、Webp を優先する fixed の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFixed_withWebp_noBase64 = graphql`
  fragment GatsbyImageSharpFixed_withWebp_noBase64 on ImageSharpFixed {
    width
    height
    src
    srcSet
    srcWebp
    srcSetWebp
  }
`

/**
 * fluid の画像用の、最も単純なフィールド一式
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid = graphql`
  fragment GatsbyImageSharpFluid on ImageSharpFluid {
    base64
    aspectRatio
    src
    srcSet
    sizes
  }
`

/**
 * fluid のコンテナからはみ出さないようにするための presentation サイズ
 * @type {Fragment}
 */
export const GatsbyImageSharpFluidLimitPresentationSize = graphql`
  fragment GatsbyImageSharpFluidLimitPresentationSize on ImageSharpFluid {
    maxHeight: presentationHeight
    maxWidth: presentationWidth
  }
`

/**
 * トレースした SVG を使う fluid の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid_tracedSVG = graphql`
  fragment GatsbyImageSharpFluid_tracedSVG on ImageSharpFluid {
    tracedSVG
    aspectRatio
    src
    srcSet
    sizes
  }
`

/**
 * Webp を優先する fluid の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid_withWebp = graphql`
  fragment GatsbyImageSharpFluid_withWebp on ImageSharpFluid {
    base64
    aspectRatio
    src
    srcSet
    srcWebp
    srcSetWebp
    sizes
  }
`

/**
 * トレースした SVG を使い、Webp を優先する fluid の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid_withWebp_tracedSVG = graphql`
  fragment GatsbyImageSharpFluid_withWebp_tracedSVG on ImageSharpFluid {
    tracedSVG
    aspectRatio
    src
    srcSet
    srcWebp
    srcSetWebp
    sizes
  }
`

/**
 * トレースした SVG を使い、ぼかした base64 画像を含まない fluid の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid_noBase64 = graphql`
  fragment GatsbyImageSharpFluid_noBase64 on ImageSharpFluid {
    aspectRatio
    src
    srcSet
    sizes
  }
`

/**
 * トレースした SVG を使い、ぼかした base64 画像を含まず、Webp を優先する fluid の画像
 * @type {Fragment}
 */
export const GatsbyImageSharpFluid_withWebp_noBase64 = graphql`
  fragment GatsbyImageSharpFluid_withWebp_noBase64 on ImageSharpFluid {
    aspectRatio
    src
    srcSet
    srcWebp
    srcSetWebp
    sizes
  }
`
