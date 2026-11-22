// @ts-check
import fs from "fs-extra"
import { fetchRemoteFile } from "gatsby-core-utils/fetch-remote-file"
import path from "path"
import {
  createUrl,
  isImage,
  mimeTypeExtensions,
  validImageFormats,
  CONTENTFUL_IMAGE_MAX_SIZE,
} from "./image-helpers"

// reject された Promise はこのマップに残す。それ以外は Promise を取り除き、そのデータを resolvedBase64Cache に入れる
const inFlightBase64Cache = new Map()
// このキャッシュには、解決済みの base64 の取得結果が入る。解決済みの Promise に対する非同期呼び出しを防ぐためである。
// 画像は w=20 の URL に基づくもので比較的小さい（2kb 未満）はずだが、メモリには残り続ける
const resolvedBase64Cache = new Map()

// Note: これは Promise<body>、body（同期）、null のいずれかを返すことがある
const getBase64Image = (imageProps, cache) => {
  if (!imageProps) {
    return null
  }

  // Contentful の Image API で配信される画像にだけ対応している
  if (imageProps.baseUrl.indexOf(`images.ctfassets.net`) === -1) {
    return null
  }

  // アスペクト比、画像フォーマット、その他の変換オプションを維持する
  const { aspectRatio } = imageProps
  const originalFormat = imageProps.image.file.contentType.split(`/`)[1]
  const toFormat = imageProps.options.toFormat
  const imageOptions = {
    ...imageProps.options,
    toFormat,
    width: 20,
    height: Math.floor(20 / aspectRatio),
  }

  const requestUrl = createUrl(imageProps.baseUrl, imageOptions)

  // データがすでにあれば、同期的に返すことを優先する
  const alreadyFetched = resolvedBase64Cache.get(requestUrl)
  if (alreadyFetched) {
    return alreadyFetched
  }

  // この URL の取得がすでに進行中であれば、最初の呼び出しと同じ Promise を返す
  const inFlight = inFlightBase64Cache.get(requestUrl)
  if (inFlight) {
    return inFlight
  }

  const loadImage = async () => {
    const {
      file: { contentType },
    } = imageProps.image

    const extension = mimeTypeExtensions.get(contentType)

    const absolutePath = await fetchRemoteFile({
      url: requestUrl,
      directory: cache.directory,
      ext: extension,
      cacheKey: imageProps.image.internal.contentDigest,
    })

    const base64 = (await fs.readFile(absolutePath)).toString(`base64`)
    return `data:image/${toFormat || originalFormat};base64,${base64}`
  }

  const promise = loadImage()
  inFlightBase64Cache.set(requestUrl, promise)

  return promise.then(body => {
    inFlightBase64Cache.delete(requestUrl)
    resolvedBase64Cache.set(requestUrl, body)
    return body
  })
}

const getTracedSVG = async ({ image, options, cache }) => {
  const { traceSVG } = await import(`gatsby-plugin-sharp`)

  const {
    file: { contentType, url: imgUrl, fileName },
  } = image

  if (contentType.indexOf(`image/`) !== 0) {
    return null
  }

  const extension = mimeTypeExtensions.get(contentType)
  const url = createUrl(imgUrl, options)
  const name = path.basename(fileName, extension)

  const absolutePath = await fetchRemoteFile({
    url,
    name,
    directory: cache.directory,
    ext: extension,
    cacheKey: image.internal.contentDigest,
  })

  return traceSVG({
    file: {
      internal: image.internal,
      name: image.file.fileName,
      extension,
      absolutePath,
    },
    args: { toFormat: ``, ...options.tracedSVGOptions },
    fileArgs: options,
  })
}

const getDominantColor = async ({ image, options, cache }) => {
  let pluginSharp

  try {
    pluginSharp = await import(`gatsby-plugin-sharp`)
  } catch (e) {
    console.error(
      `[gatsby-source-contentful] Please install gatsby-plugin-sharp`,
      e
    )
    return `rgba(0,0,0,0.5)`
  }

  try {
    const {
      file: { contentType, url: imgUrl, fileName },
    } = image

    if (contentType.indexOf(`image/`) !== 0) {
      return null
    }

    // ドミナントカラーを正しく検出するには 256px で十分なはずである
    if (!options.width) {
      options.width = 256
    }

    const extension = mimeTypeExtensions.get(contentType)
    const url = createUrl(imgUrl, options)
    const name = path.basename(fileName, extension)

    const absolutePath = await fetchRemoteFile({
      url,
      name,
      directory: cache.directory,
      ext: extension,
      cacheKey: image.internal.contentDigest,
    })

    if (!(`getDominantColor` in pluginSharp)) {
      console.error(
        `[gatsby-source-contentful] Please upgrade gatsby-plugin-sharp`
      )
      return `rgba(0,0,0,0.5)`
    }

    return pluginSharp.getDominantColor(absolutePath)
  } catch (e) {
    console.error(
      `[gatsby-source-contentful] Could not getDominantColor from image`,
      e
    )
    console.error(e)
    return `rgba(0,0,0,0.5)`
  }
}

function getBasicImageProps(image, args) {
  let aspectRatio
  if (args.width && args.height) {
    aspectRatio = args.width / args.height
  } else {
    aspectRatio =
      image.file.details.image.width / image.file.details.image.height
  }

  return {
    baseUrl: image.file.url,
    contentType: image.file.contentType,
    aspectRatio,
    width: image.file.details.image.width,
    height: image.file.details.image.height,
  }
}

// gatsby-plugin-image 用の画像ソースデータを生成する
export function generateImageSource(
  filename,
  width,
  height,
  toFormat,
  _fit, // 代わりに resizingBehavior を使う
  imageTransformOptions
) {
  const imageFormatDefaults = imageTransformOptions[`${toFormat}Options`]

  if (
    imageFormatDefaults &&
    Object.keys(imageFormatDefaults).length !== 0 &&
    imageFormatDefaults.constructor === Object
  ) {
    imageTransformOptions = {
      ...imageTransformOptions,
      ...imageFormatDefaults,
    }
  }

  const {
    jpegProgressive,
    quality,
    cropFocus,
    backgroundColor,
    resizingBehavior,
    cornerRadius,
  } = imageTransformOptions
  // Contentful の Image API の上限に収まるようにする
  if (width > CONTENTFUL_IMAGE_MAX_SIZE) {
    height = Math.floor((height / width) * CONTENTFUL_IMAGE_MAX_SIZE)
    width = CONTENTFUL_IMAGE_MAX_SIZE
  }

  if (height > CONTENTFUL_IMAGE_MAX_SIZE) {
    width = Math.floor((width / height) * CONTENTFUL_IMAGE_MAX_SIZE)
    height = CONTENTFUL_IMAGE_MAX_SIZE
  }

  if (!validImageFormats.has(toFormat)) {
    console.warn(
      `[gatsby-source-contentful] Invalid image format "${toFormat}". Supported types are jpg, png, webp and avif"`
    )
    return undefined
  }

  const src = createUrl(filename, {
    width,
    height,
    toFormat,
    resizingBehavior,
    background: backgroundColor?.replace(`#`, `rgb:`),
    quality,
    jpegProgressive,
    cropFocus,
    cornerRadius,
  })
  return { width, height, format: toFormat, src }
}

let didShowTraceSVGRemovalWarning = false
export async function resolveGatsbyImageData(
  image,
  options,
  context,
  info,
  { cache }
) {
  if (!isImage(image)) return null

  const { generateImageData } = await import(`gatsby-plugin-image`)

  const { getPluginOptions, doMergeDefaults } = await import(
    `gatsby-plugin-sharp/plugin-options`
  )

  const sharpOptions = getPluginOptions()

  const userDefaults = sharpOptions.defaults

  const defaults = {
    tracedSVGOptions: {},
    blurredOptions: {},
    jpgOptions: {},
    pngOptions: {},
    webpOptions: {},
    gifOptions: {},
    avifOptions: {},
    quality: 50,
    placeholder: `dominantColor`,
    ...userDefaults,
  }

  options = doMergeDefaults(options, defaults)

  if (options.placeholder === `tracedSVG`) {
    if (!didShowTraceSVGRemovalWarning) {
      console.warn(
        `"TRACED_SVG" placeholder argument value is no longer supported (used in ContentfulAsset.gatsbyImageData processing), falling back to "DOMINANT_COLOR". See https://gatsby.dev/tracesvg-removal/`
      )
      didShowTraceSVGRemovalWarning = true
    }
    options.placeholder = `dominantColor`
  }

  const { baseUrl, contentType, width, height } = getBasicImageProps(
    image,
    options
  )
  let [, format] = contentType.split(`/`)
  if (format === `jpeg`) {
    format = `jpg`
  }

  // Contentful の resize パラメーターを gatsby-plugin-image の CSS の object-fit に変換する
  const fitMap = new Map([
    [`pad`, `contain`],
    [`fill`, `cover`],
    [`scale`, `fill`],
    [`crop`, `cover`],
    [`thumb`, `cover`],
  ])

  const imageProps = generateImageData({
    ...options,
    pluginName: `gatsby-source-contentful`,
    sourceMetadata: { width, height, format },
    filename: baseUrl,
    generateImageSource,
    fit: fitMap.get(options.resizingBehavior),
    options,
  })

  let placeholderDataURI = null

  if (options.placeholder === `dominantColor`) {
    imageProps.backgroundColor = await getDominantColor({
      image,
      options,
      cache,
    })
  }

  if (options.placeholder === `blurred`) {
    placeholderDataURI = await getBase64Image(
      {
        baseUrl,
        image,
        options,
      },
      cache
    )
  }

  if (options.placeholder === `tracedSVG`) {
    console.error(`this shouldn't happen`)
  }

  if (placeholderDataURI) {
    imageProps.placeholder = { fallback: placeholderDataURI }
  }

  return imageProps
}
