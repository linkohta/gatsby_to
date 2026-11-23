import sharp from "./safe-sharp"
import fs from "fs-extra"

export function rgbToHex(red, green, blue) {
  return `#${(blue | (green << 8) | (red << 16) | (1 << 24))
    .toString(16)
    .slice(1)}`
}

const DEFAULT_PIXEL_DENSITIES = [0.25, 0.5, 1, 2]
const DEFAULT_FLUID_SIZE = 800

const dedupeAndSortDensities = values =>
  Array.from(new Set([1, ...values])).sort()

export function calculateImageSizes(args) {
  const { width, height, file, layout, reporter } = args

  // 指定された寸法がすべて正の値であることを確認する
  const userDimensions = { width, height }
  const erroneousUserDimensions = Object.entries(userDimensions).filter(
    ([_, size]) => typeof size === `number` && size < 1
  )
  if (erroneousUserDimensions.length) {
    throw new Error(
      `Specified dimensions for images must be positive numbers (> 0). Problem dimensions you have are ${erroneousUserDimensions
        .map(dim => dim.join(`: `))
        .join(`, `)}`
    )
  }

  if (layout === `fixed`) {
    return fixedImageSizes(args)
  } else if (layout === `fullWidth` || layout === `constrained`) {
    return responsiveImageSizes(args)
  } else {
    reporter.warn(
      `No valid layout was provided for the image at ${file.absolutePath}. Valid image layouts are fixed, fullWidth, and constrained.`
    )
    return []
  }
}

export function fixedImageSizes({
  file,
  imgDimensions,
  width,
  height,
  transformOptions = {},
  outputPixelDensities = DEFAULT_PIXEL_DENSITIES,
  reporter,
}) {
  let aspectRatio = imgDimensions.width / imgDimensions.height
  const { fit = `cover` } = transformOptions
  // ソートして重複を除き、1 が含まれるようにする
  const densities = dedupeAndSortDensities(outputPixelDensities)

  // 両方が指定されている場合は、fit を確認する必要がある
  if (width && height) {
    const calculated = getDimensionsAndAspectRatio(imgDimensions, {
      width,
      height,
      fit,
    })
    width = calculated.width
    height = calculated.height
    aspectRatio = calculated.aspectRatio
  }
  if (!width && !height) {
    width = 400
  }

  // width が渡されていない場合は、渡された height をもとに画像をリサイズする必要がある
  if (!width) {
    width = Math.round(height * aspectRatio)
  }

  const originalWidth = width // presentationWidth に使うので、失わないようにする
  const isTopSizeOverriden =
    imgDimensions.width < width || imgDimensions.height < height

  // 画像が要求より小さい場合は、そのまま処理されることをユーザーに警告する
  // サイズ計算のために上書きする前に、必要な情報を含めてこのメッセージを出力する
  if (isTopSizeOverriden) {
    const fixedDimension = imgDimensions.width < width ? `width` : `height`
    reporter.warn(`
                       The requested ${fixedDimension} "${
                         fixedDimension === `width` ? width : height
                       }px" for a resolutions field for
                       the file ${file.absolutePath}
                       was larger than the actual image ${fixedDimension} of ${
                         imgDimensions[fixedDimension]
                       }px!
                       If possible, replace the current image with a larger one.
                       `)

    if (fixedDimension === `width`) {
      width = imgDimensions.width
      height = Math.round(width / aspectRatio)
    } else {
      height = imgDimensions.height
      width = height * aspectRatio
    }
  }

  const sizes = densities
    .filter(size => size >= 1) // fixed の画像には不要なので、小さい密度を取り除く
    .map(density => Math.round(density * width))
    .filter(size => size <= imgDimensions.width)

  return {
    sizes,
    aspectRatio,
    presentationWidth: originalWidth,
    presentationHeight: Math.round(originalWidth / aspectRatio),
    unscaledWidth: width,
  }
}

export function responsiveImageSizes({
  imgDimensions,
  width,
  height,
  transformOptions = {},
  outputPixelDensities = DEFAULT_PIXEL_DENSITIES,
  breakpoints,
  layout,
}) {
  const { fit = `cover` } = transformOptions

  let sizes
  let aspectRatio = imgDimensions.width / imgDimensions.height
  // ソートして重複を除き、1 が含まれるようにする
  const densities = dedupeAndSortDensities(outputPixelDensities)

  // 両方が指定されている場合は、fit を確認する必要がある
  if (width && height) {
    const calculated = getDimensionsAndAspectRatio(imgDimensions, {
      width: width,
      height: height,
      fit,
    })
    width = calculated.width
    height = calculated.height
    aspectRatio = calculated.aspectRatio
  }

  // ケース 1: width か height が渡された場合。実際の画像より大きくならないようにする
  width = width && Math.min(width, imgDimensions.width)
  height = height && Math.min(height, imgDimensions.height)

  // ケース 2: width も height も渡されなかった場合。デフォルトのサイズを使う
  if (!width && !height) {
    width = Math.min(DEFAULT_FLUID_SIZE, imgDimensions.width)
    height = width / aspectRatio
  }

  // それでも見つからない場合は、導出した height から width を計算する
  if (!width) {
    width = height * aspectRatio
  }

  const originalWidth = width
  const isTopSizeOverriden =
    imgDimensions.width < width || imgDimensions.height < height
  if (isTopSizeOverriden) {
    width = imgDimensions.width
    height = imgDimensions.height
  }

  width = Math.round(width)

  if (breakpoints?.length > 0) {
    sizes = breakpoints.filter(size => size <= imgDimensions.width)

    // より大きいブレークポイントが取り除かれた場合は、代わりに実際の画像の幅を追加する
    if (
      sizes.length < breakpoints.length &&
      !sizes.includes(imgDimensions.width)
    ) {
      sizes.push(imgDimensions.width)
    }
  } else {
    sizes = densities.map(density => Math.round(density * width))
    sizes = sizes.filter(size => size <= imgDimensions.width)
  }

  // 渡されたサイズが最終的な出力に含まれるようにする
  if (layout === `constrained` && !sizes.includes(width)) {
    sizes.push(width)
  }
  sizes = sizes.sort((a, b) => a - b)
  return {
    sizes,
    aspectRatio,
    presentationWidth: originalWidth,
    presentationHeight: Math.round(originalWidth / aspectRatio),
    unscaledWidth: width,
  }
}

export const getSizes = (width, layout) => {
  switch (layout) {
    // 画面が最大サイズより広い場合、画像の幅は最大サイズになり、
    // そうでなければ画面の幅になる
    case `constrained`:
      return `(min-width: ${width}px) ${width}px, 100vw`

    // 画面のサイズにかかわらず、画像は常に同じ幅になる
    case `fixed`:
      return `${width}px`

    // 画像は常に画面の幅になる
    case `fullWidth`:
      return `100vw`

    default:
      return undefined
  }
}

export const getSrcSet = images =>
  images.map(image => `${image.src} ${image.width}w`).join(`,\n`)

export function getDimensionsAndAspectRatio(dimensions, options) {
  // 画像の最終的な幅と高さを計算する。
  const imageAspectRatio = dimensions.width / dimensions.height

  let width = options.width
  let height = options.height

  switch (options.fit) {
    case sharp.fit.fill: {
      width = options.width ? options.width : dimensions.width
      height = options.height ? options.height : dimensions.height
      break
    }
    case sharp.fit.inside: {
      const widthOption = options.width
        ? options.width
        : Number.MAX_SAFE_INTEGER
      const heightOption = options.height
        ? options.height
        : Number.MAX_SAFE_INTEGER

      width = Math.min(widthOption, Math.round(heightOption * imageAspectRatio))
      height = Math.min(
        heightOption,
        Math.round(widthOption / imageAspectRatio)
      )
      break
    }
    case sharp.fit.outside: {
      const widthOption = options.width ? options.width : 0
      const heightOption = options.height ? options.height : 0

      width = Math.max(widthOption, Math.round(heightOption * imageAspectRatio))
      height = Math.max(
        heightOption,
        Math.round(widthOption / imageAspectRatio)
      )
      break
    }

    default: {
      if (options.width && !options.height) {
        width = options.width
        height = Math.round(options.width / imageAspectRatio)
      }

      if (options.height && !options.width) {
        width = Math.round(options.height * imageAspectRatio)
        height = options.height
      }
    }
  }

  return {
    width,
    height,
    aspectRatio: width / height,
  }
}

const dominantColorCache = new Map()

export const getDominantColor = async absolutePath => {
  let dominantColor = dominantColorCache.get(absolutePath)
  if (dominantColor) {
    return dominantColor
  }

  const pipeline = sharp()

  fs.createReadStream(absolutePath).pipe(pipeline)

  const { dominant } = await pipeline.stats()

  // sharp が dominant に対応していない場合のフォールバック
  dominantColor = dominant
    ? rgbToHex(dominant.r, dominant.g, dominant.b)
    : `rgba(0,0,0,0.5)`

  dominantColorCache.set(absolutePath, dominantColor)

  return dominantColor
}
