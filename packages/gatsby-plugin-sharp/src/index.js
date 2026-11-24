const sharp = require(`./safe-sharp`)
const { generateImageData } = require(`./image-data`)
const imageSize = require(`probe-image-size`)
const { isCI } = require(`gatsby-core-utils/ci`)

const _ = require(`lodash`)
const fs = require(`fs-extra`)
const path = require(`path`)

const { createArgsDigest } = require(`./process-file`)
const { reportError } = require(`./report-error`)
const {
  getPluginOptions,
  healOptions,
  createTransformObject,
  removeDefaultValues,
} = require(`./plugin-options`)
const duotone = require(`./duotone`)
const { IMAGE_PROCESSING_JOB_NAME } = require(`./gatsby-worker`)
const { getDimensionsAndAspectRatio } = require(`./utils`)
const { getDominantColor } = require(`./utils`)

const imageSizeCache = new Map()

const getImageSizeAsync = async file => {
  if (
    process.env.NODE_ENV !== `test` &&
    imageSizeCache.has(file.internal.contentDigest)
  ) {
    return imageSizeCache.get(file.internal.contentDigest)
  }
  const input = fs.createReadStream(file.absolutePath)
  const dimensions = await imageSize(input)

  if (!dimensions) {
    reportError(
      `gatsby-plugin-sharp couldn't determine dimensions for file:\n${file.absolutePath}\nThis file is unusable and is most likely corrupt.`,
      ``
    )
  }

  imageSizeCache.set(file.internal.contentDigest, dimensions)
  return dimensions
}
// 非常に遅いので、次のメジャーで削除する
const getImageSize = file => {
  if (
    process.env.NODE_ENV !== `test` &&
    imageSizeCache.has(file.internal.contentDigest)
  ) {
    return imageSizeCache.get(file.internal.contentDigest)
  } else {
    const dimensions = imageSize.sync(fs.readFileSync(file.absolutePath))

    if (!dimensions) {
      reportError(
        `gatsby-plugin-sharp couldn't determine dimensions for file:\n${file.absolutePath}\nThis file is unusable and is most likely corrupt.`,
        ``
      )
    }

    imageSizeCache.set(file.internal.contentDigest, dimensions)
    return dimensions
  }
}

// actions は、gatsby-node の onPreInit に渡されたときに設定されるべきである。
// ** gatsby モジュールを直接 require するのは安全ではない **。
// 解決されたモジュールが、実行中のモジュールと同じである保証はない！
// モノレポでは、依存の巻き上げ方によってこれが起こりうる。
// 直接の require は、破壊的変更を避けるためだけに残してある。
let actions
exports.setActions = _actions => {
  actions = _actions
}

exports.generateImageData = generateImageData

function calculateImageDimensionsAndAspectRatio(file, options) {
  const dimensions = getImageSize(file)
  return getDimensionsAndAspectRatio(dimensions, options)
}

function prepareQueue({ file, args }) {
  const { pathPrefix, duotone, ...rest } = args
  // duotone は transformOptions の中の入れ子のオブジェクトで、[Object: Null Prototype] を持つ
  // そのため、createArgsDigest が duotone も考慮するよう、新しいオブジェクトへ平坦化している
  const digestArgs = Object.assign(rest, duotone)
  const argsDigestShort = createArgsDigest(digestArgs)
  const imgSrc = `/${file.name}.${args.toFormat}`
  const outputDir = path.join(
    process.cwd(),
    `public`,
    `static`,
    file.internal.contentDigest
  )
  const outputFilePath = path.join(argsDigestShort, imgSrc)

  // outputDir が確実に作成されているようにする
  fs.ensureDirSync(outputDir)

  const { width, height, aspectRatio } = calculateImageDimensionsAndAspectRatio(
    file,
    args
  )

  // ファイル名を URL 用にエンコードする
  const encodedImgSrc = `/${encodeURIComponent(file.name)}.${args.toFormat}`

  // 画像の src にプレフィックスを付ける。
  const digestDirPrefix = `${file.internal.contentDigest}/${argsDigestShort}`
  const prefixedSrc =
    (pathPrefix ? pathPrefix : ``) +
    `/static/${digestDirPrefix}` +
    encodedImgSrc

  return {
    src: prefixedSrc,
    outputDir: outputDir,
    relativePath: outputFilePath,
    width,
    height,
    aspectRatio,
    options: removeDefaultValues(args, getPluginOptions()),
  }
}

function createJob(job, { reporter }) {
  if (!actions) {
    reporter.panic(
      `Gatsby-plugin-sharp wasn't setup correctly in gatsby-config.js. Make sure you add it to the plugins array.`
    )
  }

  // ジョブは重複することがあり、たいていは長時間かかるタスクである。
  // そのため、async/await は使わず、.then() と .catch() の
  // ハンドラーを使う。こうすると、V8 が重複したジョブを
  // メモリーからすぐに解放できる（resolve と reject のハンドラーが
  // ジョブを参照しないため）。async/await を使うと、
  // 最初のジョブが終わるまで、クロージャ全体が重複したジョブを
  // メモリーに保持してしまう。
  const promise = actions.createJobV2(job).catch(err => {
    reporter.panic(`error converting image`, err)
  })

  return promise
}

function lazyJobsEnabled() {
  return (
    process.env.gatsby_executing_command === `develop` &&
    (!isCI() || process.env.GATSBY_ENABLE_LAZY_IMAGES_IN_CI) &&
    !(
      process.env.ENABLE_GATSBY_EXTERNAL_JOBS === `true` ||
      process.env.ENABLE_GATSBY_EXTERNAL_JOBS === `1`
    )
  )
}

function queueImageResizing({ file, args = {}, reporter }) {
  const fullOptions = healOptions(getPluginOptions(), args, file.extension)
  const { src, width, height, aspectRatio, relativePath, outputDir, options } =
    prepareQueue({ file, args: createTransformObject(fullOptions) })

  // ジョブを作成してキューに追加する。キューは gatsby-node.js の中で処理される
  const finishedPromise = createJob(
    {
      name: IMAGE_PROCESSING_JOB_NAME,
      inputPaths: [file.absolutePath],
      outputDir,
      args: {
        isLazy: lazyJobsEnabled(),
        operations: [
          {
            outputPath: relativePath,
            args: options,
          },
        ],
        pluginOptions: getPluginOptions(),
      },
    },
    { reporter }
  )

  return {
    src,
    absolutePath: path.join(outputDir, relativePath),
    width,
    height,
    aspectRatio,
    finishedPromise,
    originalName: file.base,
  }
}

function batchQueueImageResizing({ file, transforms = [], reporter }) {
  const operations = []
  const images = []

  // すべての変換をループして、正しい変数を設定する
  transforms.forEach(transform => {
    const {
      src,
      width,
      height,
      aspectRatio,
      relativePath,
      outputDir,
      options,
    } = prepareQueue({ file, args: transform })
    // 画像の操作をキューに入れる
    operations.push({
      outputPath: relativePath,
      args: options,
    })

    // 出力結果を作成する
    images.push({
      src,
      absolutePath: path.join(outputDir, relativePath),
      width,
      height,
      aspectRatio,
      originalName: file.base,
      finishedPromise: null,
    })
  })

  const finishedPromise = createJob(
    {
      name: IMAGE_PROCESSING_JOB_NAME,
      inputPaths: [file.absolutePath],
      outputDir: path.join(
        process.cwd(),
        `public`,
        `static`,
        file.internal.contentDigest
      ),
      args: {
        isLazy: lazyJobsEnabled(),
        operations,
        pluginOptions: getPluginOptions(),
      },
    },
    { reporter }
  )

  return images.map(image => {
    image.finishedPromise = finishedPromise

    return image
  })
}

async function generateBase64({ file, args = {}, reporter }) {
  const pluginOptions = getPluginOptions()
  const options = healOptions(pluginOptions, args, file.extension, {
    // `generateBase64()` を呼び出す `fluid()` と `fixed()` のメソッドによって、すでに
    // base64Width に設定されているはずである。Jest のテストではまだ役に立つ。
    width: args.base64Width || pluginOptions.base64Width,
  })
  let pipeline
  try {
    pipeline = sharp({ failOn: pluginOptions.failOn })

    if (!options.rotate) {
      pipeline.rotate()
    }
    fs.createReadStream(file.absolutePath).pipe(pipeline)
  } catch (err) {
    reportError(`Failed to process image ${file.absolutePath}`, err, reporter)
    return null
  }

  if (options.trim) {
    // sharp 0.33 以降の `trim` はオブジェクトしか受け取らない。数値は、これまでどおりしきい値として渡す
    pipeline = pipeline.trim({ threshold: options.trim })
  }

  const changedBase64Format =
    options.toFormatBase64 || pluginOptions.forceBase64Format
  if (changedBase64Format) {
    options.toFormat = changedBase64Format
  }

  pipeline
    .resize({
      width: options.width,
      height: options.height,
      position: options.cropFocus,
      fit: options.fit,
      background: options.background,
    })
    .png({
      compressionLevel: options.pngCompressionLevel,
      adaptiveFiltering: false,
      force: options.toFormat === `png`,
    })
    .jpeg({
      quality: options.jpegQuality || options.quality,
      progressive: options.jpegProgressive,
      force: options.toFormat === `jpg`,
    })
    .webp({
      quality: options.webpQuality || options.quality,
      force: options.toFormat === `webp`,
    })

  // grayscale
  if (options.grayscale) {
    pipeline = pipeline.grayscale()
  }

  // rotate
  if (options.rotate && options.rotate !== 0) {
    pipeline = pipeline.rotate(options.rotate)
  }

  // duotone
  if (options.duotone) {
    if (options.duotone.highlight && options.duotone.shadow) {
      pipeline = await duotone(options.duotone, options.toFormat, pipeline)
    } else {
      reporter.warn(
        `Invalid duotone option specified for ${file.absolutePath}, ignoring. Please pass an object to duotone with the keys "highlight" and "shadow" set to the corresponding hex values you want to use.`
      )
    }
  }
  let buffer
  let info
  try {
    const result = await pipeline.toBuffer({
      resolveWithObject: true,
    })
    buffer = result.data
    info = result.info
  } catch (err) {
    reportError(
      `Failed to process image ${file.absolutePath}.
It is probably corrupt, so please try replacing it.  If it still fails, please open an issue with the image attached.`,
      err,
      reporter
    )
    return null
  }

  const base64output = {
    src: `data:image/${info.format};base64,${buffer.toString(`base64`)}`,
    width: info.width,
    height: info.height,
    aspectRatio: info.width / info.height,
    originalName: file.base,
  }
  return base64output
}

const generateCacheKey = ({ file, args }) =>
  `${file.internal.contentDigest}${JSON.stringify(args)}`

const memoizedBase64 = _.memoize(generateBase64, generateCacheKey)

const cachifiedProcess = async ({ cache, ...arg }, genKey, processFn) => {
  const cachedKey = genKey(arg)
  const cached = await cache.get(cachedKey)

  if (cached) {
    return cached
  }

  const result = await processFn(arg)
  await cache.set(cachedKey, result)

  return result
}

async function base64(arg) {
  if (arg.cache) {
    // すべてのトランスフォーマープラグインがキャッシュを提供するわけではない
    return await cachifiedProcess(arg, generateCacheKey, generateBase64)
  }

  return await memoizedBase64(arg)
}

let didShowTraceSVGRemovalWarning = false
async function traceSVG(args) {
  if (!didShowTraceSVGRemovalWarning) {
    console.warn(
      `traceSVG placeholder generation is no longer supported, falling back to blurred. See https://gatsby.dev/tracesvg-removal/`
    )
    didShowTraceSVGRemovalWarning = true
  }

  const { src } = await base64(args)
  return src
}

async function stats({ file, reporter }) {
  const pluginOptions = getPluginOptions()
  let imgStats
  try {
    const pipeline = sharp({ failOn: pluginOptions.failOn })
    fs.createReadStream(file.absolutePath).pipe(pipeline)

    imgStats = await pipeline.stats()
  } catch (err) {
    reportError(
      `Failed to get stats for image ${file.absolutePath}`,
      err,
      reporter
    )
    return null
  }

  return {
    isTransparent: !imgStats.isOpaque,
  }
}

let didShowTraceSVGRemovalWarningFluid = false
async function fluid({ file, args = {}, reporter, cache }) {
  const pluginOptions = getPluginOptions()
  const options = healOptions(pluginOptions, args, file.extension)

  let metadata
  try {
    const pipeline = sharp({ failOn: pluginOptions.failOn })
    fs.createReadStream(file.absolutePath).pipe(pipeline)

    metadata = await pipeline.metadata()
  } catch (err) {
    reportError(
      `Failed to retrieve metadata from image ${file.absolutePath}`,
      err,
      reporter
    )
    return null
  }

  const { width, height, density, format } = metadata

  // maxWidth が渡されていない場合は、渡された maxHeight をもとに画像をリサイズする必要がある
  const fixedDimension =
    options.maxWidth === undefined ? `maxHeight` : `maxWidth`
  const maxWidth = options.maxWidth
    ? Math.min(options.maxWidth, width)
    : undefined
  const maxHeight = options.maxHeight
    ? Math.min(options.maxHeight, height)
    : undefined

  if (options[fixedDimension] < 1) {
    throw new Error(
      `${fixedDimension} has to be a positive int larger than zero (> 0), now it's ${options[fixedDimension]}`
    )
  }

  // カスタムのブレークポイントが指定されていない場合に、画像のサイズ（幅）を
  // 作成する。レンダリングされる markdown ファイルのコンテナの最大幅が
  // 800px であれば、サイズは 200、400、800、1200、1600 になる。
  //
  // これだけのサイズがあれば、あらゆるデバイスのサイズと画面解像度に対して
  // 最適に近い画像サイズを提供でき、（おそらく）画像処理の時間も
  // かかりすぎない（ありがたいことに、Sharp は同じ入力ファイルから
  // 複数のサイズを作成する処理を最適化している）
  const fluidSizes = [
    options[fixedDimension], // maxWidth（または maxHeight）が確実に追加されるようにする
  ]
  // カスタムのブレークポイントが指定されていない場合は、標準のブレークポイントを使う
  if (!options.srcSetBreakpoints || !options.srcSetBreakpoints.length) {
    fluidSizes.push(options[fixedDimension] / 4)
    fluidSizes.push(options[fixedDimension] / 2)
    fluidSizes.push(options[fixedDimension] * 1.5)
    fluidSizes.push(options[fixedDimension] * 2)
  } else {
    options.srcSetBreakpoints.forEach(breakpoint => {
      if (breakpoint < 1) {
        throw new Error(
          `All ints in srcSetBreakpoints should be positive ints larger than zero (> 0), found ${breakpoint}`
        )
      }
      // 重複が追加されないようにする
      if (fluidSizes.includes(breakpoint)) {
        return
      }
      fluidSizes.push(breakpoint)
    })
  }
  let filteredSizes = fluidSizes.filter(
    size => size < (fixedDimension === `maxWidth` ? width : height)
  )

  // 小さい画像でも可能な限り大きい画像を使えるよう、
  // 元の画像を追加する。元の画像へリンクできるように
  // するためでもある。
  filteredSizes.push(fixedDimension === `maxWidth` ? width : height)
  filteredSizes = _.sortBy(filteredSizes)

  // 各サイズを処理のキューに入れる。
  const dimensionAttr = fixedDimension === `maxWidth` ? `width` : `height`
  const otherDimensionAttr = fixedDimension === `maxWidth` ? `height` : `width`

  const imageWithDensityOneIndex = filteredSizes.findIndex(
    size => size === (fixedDimension === `maxWidth` ? maxWidth : maxHeight)
  )

  // 見やすいようサイズをソートする。
  const transforms = filteredSizes.map(size => {
    const arrrgs = createTransformObject(options)
    if (arrrgs[otherDimensionAttr]) {
      arrrgs[otherDimensionAttr] = undefined
    }
    arrrgs[dimensionAttr] = Math.round(size)

    // 正しい outputPath を計算するために pathPrefix が必要である
    if (options.pathPrefix) {
      arrrgs.pathPrefix = options.pathPrefix
    }

    if (options.maxWidth !== undefined && options.maxHeight !== undefined) {
      if (options.fit === sharp.fit.inside) {
        arrrgs.height = Math.round(size * (maxHeight / maxWidth))
      } else {
        arrrgs.height = Math.round(
          size * (options.maxHeight / options.maxWidth)
        )
      }
    }

    return arrrgs
  })

  const images = batchQueueImageResizing({
    file,
    transforms,
    reporter,
  })

  if (options.generateTracedSVG && options.tracedSVG) {
    if (!didShowTraceSVGRemovalWarningFluid) {
      console.warn(
        `tracedSVG placeholder generation for fluid images is no longer supported, falling back to blurred. See https://gatsby.dev/tracesvg-removal/`
      )
      didShowTraceSVGRemovalWarningFluid = true
    }
  }

  let base64Image
  if (options.base64 || (options.generateTracedSVG && options.tracedSVG)) {
    const base64Width = options.base64Width
    const base64Height = Math.max(
      1,
      Math.round(base64Width / images[0].aspectRatio)
    )
    const base64Args = {
      background: options.background,
      duotone: options.duotone,
      grayscale: options.grayscale,
      rotate: options.rotate,
      trim: options.trim,
      toFormat: options.toFormat,
      toFormatBase64: options.toFormatBase64,
      cropFocus: options.cropFocus,
      fit: options.fit,
      width: base64Width,
      height: base64Height,
    }
    // base64 版を取得する
    base64Image = await base64({ file, args: base64Args, reporter, cache })
  }

  // src と srcSet の文字列を組み立てる。
  const originalImg = _.maxBy(images, image => image.width).src
  const fallbackSrc = _.minBy(images, image =>
    Math.abs(options[fixedDimension] - image[dimensionAttr])
  ).src

  const srcSet = images
    .map(image => `${image.src} ${Math.round(image.width)}w`)
    .join(`,\n`)
  const originalName = file.base

  // srcSet のフォーマットを決める
  let srcSetType = `image/${format}`

  if (options.toFormat) {
    switch (options.toFormat) {
      case `png`:
        srcSetType = `image/png`
        break
      case `jpg`:
        srcSetType = `image/jpeg`
        break
      case `webp`:
        srcSetType = `image/webp`
        break
      case `avif`:
        srcSetType = `image/avif`
        break
      case ``:
      case `no_change`:
      default:
        break
    }
  }

  // presentationSizes を計算する
  const imageWithDensityOne = images[imageWithDensityOneIndex]
  const presentationWidth = imageWithDensityOne.width
  const presentationHeight = imageWithDensityOne.height

  // ユーザーがデフォルトの sizes を設定していない場合は、こちらで作成する。
  const sizes =
    options.sizes ||
    `(max-width: ${presentationWidth}px) 100vw, ${presentationWidth}px`

  return {
    base64: (options.base64 && base64Image && base64Image.src) || undefined,
    aspectRatio: images[0].aspectRatio,
    src: fallbackSrc,
    srcSet,
    srcSetType,
    sizes,
    originalImg,
    originalName,
    density,
    presentationWidth,
    presentationHeight,
    tracedSVG:
      (options.generateTracedSVG &&
        options.tracedSVG &&
        base64Image &&
        base64Image.src) ||
      undefined,
  }
}

let didShowTraceSVGRemovalWarningFixed = false
async function fixed({ file, args = {}, reporter, cache }) {
  const options = healOptions(getPluginOptions(), args, file.extension)

  // width が渡されていない場合は、渡された height をもとに画像をリサイズする必要がある
  const fixedDimension = options.width === undefined ? `height` : `width`

  // 異なる解像度用のサイズを作成する。1x、1.5x、2x を用意する。
  const sizes = []
  sizes.push(options[fixedDimension])
  sizes.push(options[fixedDimension] * 1.5)
  sizes.push(options[fixedDimension] * 2)
  const dimensions = await getImageSizeAsync(file)

  const filteredSizes = sizes.filter(size => size <= dimensions[fixedDimension])

  // 絞り込んだ結果 fluid の画像が残らない場合（画像が要求より
  // 小さい場合など）は、少なくとも何かがあるよう、元の画像を戻す
  if (filteredSizes.length === 0) {
    filteredSizes.push(dimensions[fixedDimension])
    console.warn(
      `
                 The requested ${fixedDimension} "${options[fixedDimension]}px" for a resolutions field for
                 the file ${file.absolutePath}
                 was larger than the actual image ${fixedDimension} of ${dimensions[fixedDimension]}px!
                 If possible, replace the current image with a larger one.
                 `
    )
  }

  // 見やすいよう画像をソートする。
  const transforms = _.sortBy(filteredSizes).map(size => {
    const arrrgs = createTransformObject(options)
    arrrgs[fixedDimension] = Math.round(size)

    // 画像を処理のキューに入れる。
    if (options.width !== undefined && options.height !== undefined) {
      arrrgs.height = Math.round(size * (options.height / options.width))
    }
    // 正しい outputPath を計算するために pathPrefix が必要である
    if (options.pathPrefix) {
      arrrgs.pathPrefix = options.pathPrefix
    }

    return arrrgs
  })

  const images = batchQueueImageResizing({
    file,
    transforms,
    reporter,
  })

  if (options.generateTracedSVG && options.tracedSVG) {
    if (!didShowTraceSVGRemovalWarningFixed) {
      console.warn(
        `tracedSVG placeholder generation for fixed images is no longer supported, falling back to blurred. See https://gatsby.dev/tracesvg-removal/`
      )
      didShowTraceSVGRemovalWarningFixed = true
    }
  }

  let base64Image
  if (options.base64 || (options.generateTracedSVG && options.tracedSVG)) {
    const base64Width = options.base64Width
    const base64Height = Math.max(
      1,
      Math.round(base64Width / images[0].aspectRatio)
    )
    const base64Args = {
      background: options.background,
      duotone: options.duotone,
      grayscale: options.grayscale,
      rotate: options.rotate,
      trim: options.trim,
      toFormat: options.toFormat,
      toFormatBase64: options.toFormatBase64,
      cropFocus: options.cropFocus,
      fit: options.fit,
      width: base64Width,
      height: base64Height,
    }
    // base64 版を取得する
    base64Image = await base64({
      file,
      args: base64Args,
      reporter,
      cache,
    })
  }

  const fallbackSrc = images[0].src
  const srcSet = images
    .map((image, i) => {
      let resolution
      switch (i) {
        case 0:
          resolution = `1x`
          break
        case 1:
          resolution = `1.5x`
          break
        case 2:
          resolution = `2x`
          break
        default:
      }
      return `${image.src} ${resolution}`
    })
    .join(`,\n`)

  const originalName = file.base

  return {
    base64: (options.base64 && base64Image && base64Image.src) || undefined,
    aspectRatio: images[0].aspectRatio,
    width: images[0].width,
    height: images[0].height,
    src: fallbackSrc,
    srcSet,
    originalName: originalName,
    tracedSVG:
      (options.generateTracedSVG &&
        options.tracedSVG &&
        base64Image &&
        base64Image.src) ||
      undefined,
  }
}

exports.queueImageResizing = queueImageResizing
exports.batchQueueImageResizing = batchQueueImageResizing
exports.resize = queueImageResizing
exports.base64 = base64
exports.generateBase64 = generateBase64
exports.traceSVG = traceSVG
exports.sizes = fluid
exports.resolutions = fixed
exports.fluid = fluid
exports.fixed = fixed
exports.getImageSize = getImageSize
exports.getImageSizeAsync = getImageSizeAsync
exports.getDominantColor = getDominantColor
exports.stats = stats
exports._unstable_createJob = createJob
exports._lazyJobsEnabled = lazyJobsEnabled
