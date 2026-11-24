const {
  DEFAULT_OPTIONS,
  EMPTY_ALT,
  imageClass,
  imageBackgroundClass,
  imageWrapperClass,
} = require(`./constants`)
const visitWithParents = require(`unist-util-visit-parents`)
const getDefinitions = require(`mdast-util-definitions`)
const path = require(`path`)
// query-string 8 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: queryString } = require(`query-string`)
// is-relative-url 4 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: isRelativeUrl } = require(`is-relative-url`)
const _ = require(`lodash`)
const { fluid, stats, traceSVG } = require(`gatsby-plugin-sharp`)
const Promise = require(`bluebird`)
const cheerio = require(`cheerio`)
const { slash } = require(`gatsby-core-utils`)
// chalk 5 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: chalk } = require(`chalk`)

// https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby-transformer-sharp/src/supported-extensions.js と同じ内容にすること
const supportedExtensions = {
  jpeg: true,
  jpg: true,
  png: true,
  webp: true,
  tif: true,
  tiff: true,
  avif: true,
}

// 画像が相対パスの（他の場所でホストされていない）場合
// 1. 画像ファイルを見つける
// 2. 画像のサイズを調べる
// 3. レスポンシブ画像の fluid のサイズのうち、画像の幅より大きいものを取り除く
// 4. レスポンシブ画像を作成する。
// 5. アスペクト比のヘルパー付きの html を設定する。
module.exports = (
  {
    files,
    markdownNode,
    markdownAST,
    pathPrefix,
    getNode,
    reporter,
    cache,
    compiler,
    getRemarkFileDependency,
  },
  pluginOptions
) => {
  const options = _.defaults({}, pluginOptions, { pathPrefix }, DEFAULT_OPTIONS)

  const findParentLinks = ({ children }) =>
    children.some(
      node =>
        (node.type === `html` && !!node.value.match(/<a /)) ||
        node.type === `link`
    )

  // markdown ツリー内の利用可能な定義をすべて取得する
  const definitions = getDefinitions(markdownAST)

  // これにより html の image タグを使えるようになる
  // const rawHtmlNodes = select(markdownAST, `html`)
  const rawHtmlNodes = []
  visitWithParents(markdownAST, [`html`, `jsx`], (node, ancestors) => {
    const inLink = ancestors.some(findParentLinks)

    rawHtmlNodes.push({ node, inLink })
  })

  // これは markdown 構文の画像タグでしか動作しない
  const markdownImageNodes = []

  visitWithParents(
    markdownAST,
    [`image`, `imageReference`],
    (node, ancestors) => {
      const inLink = ancestors.some(findParentLinks)

      markdownImageNodes.push({ node, inLink })
    }
  )

  const getImageInfo = uri => {
    const { url, query } = queryString.parseUrl(uri)
    return {
      ext: path.extname(url).split(`.`).pop(),
      url,
      query,
    }
  }

  const getImageCaption = async (node, overWrites) => {
    const getCaptionString = () => {
      const captionOptions = Array.isArray(options.showCaptions)
        ? options.showCaptions
        : options.showCaptions === true
          ? [`title`, `alt`]
          : false

      if (captionOptions) {
        for (const option of captionOptions) {
          switch (option) {
            case `title`:
              if (node.title) {
                return node.title
              }
              break
            case `alt`:
              if (node.alt === EMPTY_ALT || overWrites.alt === EMPTY_ALT) {
                return ``
              }
              if (overWrites.alt) {
                return overWrites.alt
              }
              if (node.alt) {
                return node.alt
              }
              break
          }
        }
      }

      return ``
    }

    const captionString = getCaptionString()

    if (!options.markdownCaptions || !compiler) {
      return _.escape(captionString)
    }

    return compiler.generateHTML(await compiler.parseString(captionString))
  }

  // ノードを受け取って必要な画像を生成し、
  // 画像を置き換えるための HTML を返す
  const generateImagesAndUpdateNode = async function (
    node,
    resolve,
    inLink,
    overWrites = {}
  ) {
    // この markdownNode が File の親を持つかを確認する。画像が
    // ローカルでホストされていなければ、このプラグインは動作しない。
    let parentNode = getNode(markdownNode.parent)
    // 親ノードが File ノードかを確認し、そうでなければ親をたどって
    // 最も近い File の親ノードを探す。子ノードに markdown がある場合
    // （gatsby-plugin-json-remark など）に必要である。
    if (
      parentNode &&
      parentNode.internal &&
      parentNode.internal.type !== `File`
    ) {
      let tempParentNode = parentNode
      while (
        tempParentNode &&
        tempParentNode.internal &&
        tempParentNode.internal.type !== `File`
      ) {
        tempParentNode = getNode(tempParentNode.parent)
      }
      if (
        tempParentNode &&
        tempParentNode.internal &&
        tempParentNode.internal.type === `File`
      ) {
        parentNode = tempParentNode
      }
    }
    let imagePath
    if (parentNode && parentNode.dir) {
      imagePath = slash(path.join(parentNode.dir, getImageInfo(node.url).url))
    } else {
      return null
    }

    let imageNode
    if (getRemarkFileDependency) {
      imageNode = await getRemarkFileDependency({
        absolutePath: {
          eq: imagePath,
        },
      })
    } else {
      // レガシー: context がなく、画像クエリの遅いほうのバージョン
      imageNode = _.find(files, file => {
        if (file && file.absolutePath) {
          return file.absolutePath === imagePath
        }
        return null
      })
    }

    if (!imageNode || !imageNode.absolutePath) {
      return resolve()
    }

    const fluidResult = await fluid({
      file: imageNode,
      args: options,
      reporter,
      cache,
    })

    if (!fluidResult) {
      return resolve()
    }

    const originalImg = fluidResult.originalImg
    const fallbackSrc = fluidResult.src
    const srcSet = fluidResult.srcSet
    const presentationWidth = fluidResult.presentationWidth

    // デフォルトの alt を生成する
    const srcSplit = getImageInfo(node.url).url.split(`/`)
    const fileName = srcSplit[srcSplit.length - 1]
    const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ``)
    const defaultAlt = fileNameNoExt.replace(/[^A-Z0-9]/gi, ` `)
    const isEmptyAlt = node.alt === EMPTY_ALT

    const alt = isEmptyAlt
      ? ``
      : _.escape(
          overWrites.alt ? overWrites.alt : node.alt ? node.alt : defaultAlt
        )

    const title = node.title ? _.escape(node.title) : ``

    const loading = options.loading

    if (![`lazy`, `eager`, `auto`].includes(loading)) {
      reporter.warn(
        reporter.stripIndent(`
        ${chalk.bold(loading)} is an invalid value for the ${chalk.bold(
          `loading`
        )} option. Please pass one of "lazy", "eager" or "auto".
      `)
      )
    }

    const decoding = options.decoding

    if (![`async`, `sync`, `auto`].includes(decoding)) {
      reporter.warn(
        reporter.stripIndent(`
        ${chalk.bold(decoding)} is an invalid value for the ${chalk.bold(
          `decoding`
        )} option. Please pass one of "async", "sync" or "auto".
      `)
      )
    }

    const imageStyle = `
      width: 100%;
      height: 100%;
      margin: 0;
      vertical-align: middle;
      position: absolute;
      top: 0;
      left: 0;`.replace(/\s*(\S+:)\s*/g, `$1`)

    // ベースになる image タグを作成する
    let imageTag = `
      <img
        class="${imageClass}"
        alt="${alt}"
        title="${title}"
        src="${fallbackSrc}"
        srcset="${srcSet}"
        sizes="${fluidResult.sizes}"
        style="${imageStyle}"
        loading="${loading}"
        decoding="${decoding}"
      />
    `.trim()

    const formatConfigs = [
      {
        propertyName: `withAvif`,
        format: `AVIF`,
      },
      {
        propertyName: `withWebp`,
        format: `WEBP`,
      },
    ]

    const enabledFormatConfigs = formatConfigs.filter(
      ({ propertyName }) => options[propertyName]
    )

    if (enabledFormatConfigs.length) {
      const sourcesHtmlPromises = enabledFormatConfigs.map(
        async ({ format, propertyName }) => {
          const formatFluidResult = await fluid({
            file: imageNode,
            args: _.defaults(
              { toFormat: format },
              // オブジェクトであればオプションを上書きし、そうでなければデフォルトをそのまま渡す
              options[propertyName] === true ? {} : options[propertyName],
              options
            ),
            reporter,
          })

          if (!formatFluidResult) {
            return null
          }

          return `
            <source
              srcset="${formatFluidResult.srcSet}"
              sizes="${formatFluidResult.sizes}"
              type="${formatFluidResult.srcSetType}"
            />
          `.trim()
        }
      )

      const sourcesHtml = (await Promise.all(sourcesHtmlPromises)).filter(
        sourceHtml => sourceHtml !== null
      )

      if (!sourcesHtml.length) {
        return resolve()
      }

      imageTag = `
        <picture>
          ${sourcesHtml.join(``)}
          <source
            srcset="${srcSet}"
            sizes="${fluidResult.sizes}"
            type="${fluidResult.srcSetType}"
          />
          <img
            class="${imageClass}"
            src="${fallbackSrc}"
            alt="${alt}"
            title="${title}"
            loading="${loading}"
            decoding="${decoding}"
            style="${imageStyle}"
          />
        </picture>
      `.trim()
    }

    const placeholderImageData = fluidResult.base64

    const ratio = `${(1 / fluidResult.aspectRatio) * 100}%`

    const wrapperStyle =
      typeof options.wrapperStyle === `function`
        ? options.wrapperStyle(fluidResult)
        : options.wrapperStyle

    // アスペクト比のプレースホルダー付きの新しい画像ノードを組み立てる
    const imageCaption =
      options.showCaptions && (await getImageCaption(node, overWrites))

    let removeBgImage = false
    if (options.disableBgImageOnAlpha) {
      const imageStats = await stats({ file: imageNode, reporter })
      if (imageStats && imageStats.isTransparent) removeBgImage = true
    }
    if (options.disableBgImage) {
      removeBgImage = true
    }

    const bgImage = removeBgImage
      ? ``
      : ` background-image: url('${placeholderImageData}'); background-size: cover;`

    let rawHTML = `
  <span
    class="${imageBackgroundClass}"
    style="padding-bottom: ${ratio}; position: relative; bottom: 0; left: 0;${bgImage} display: block;"
  ></span>
  ${imageTag}
  `.trim()

    // 元の画像へのリンクを任意にする。
    if (!inLink && options.linkImagesToOriginal) {
      rawHTML = `
  <a
    class="gatsby-resp-image-link"
    href="${originalImg}"
    style="display: block"
    target="_blank"
    rel="noopener"
  >
    ${rawHTML}
  </a>
    `.trim()
    }

    rawHTML = `
    <span
      class="${imageWrapperClass}"
      style="position: relative; display: block; margin-left: auto; margin-right: auto; max-width: ${presentationWidth}px; ${
        imageCaption ? `` : wrapperStyle
      }"
    >
      ${rawHTML}
    </span>
    `.trim()

    // figure で包み、title をキャプションとして使う
    if (imageCaption) {
      rawHTML = `
  <figure class="gatsby-resp-image-figure" style="${wrapperStyle}">
    ${rawHTML}
    <figcaption class="gatsby-resp-image-figcaption">${imageCaption}</figcaption>
  </figure>
      `.trim()
    }

    return rawHTML
  }

  return Promise.all(
    // markdown には入れ子がないので単純である
    markdownImageNodes.map(
      ({ node, inLink }) =>
        new Promise(resolve => {
          const overWrites = {}
          let refNode
          if (
            !node.hasOwnProperty(`url`) &&
            node.hasOwnProperty(`identifier`)
          ) {
            // imageReference ノードとして扱う
            refNode = node
            node = definitions(refNode.identifier)
            // 参照元のノードの元の alt を渡す
            overWrites.alt = refNode.alt
            if (!node) {
              // 画像の参照に対応する定義が見つからないので、
              // 何もすることがない。
              return resolve()
            }
          }
          const fileType = getImageInfo(node.url).ext

          // 対応している拡張子だけを変換の対象にする
          if (isRelativeUrl(node.url) && supportedExtensions[fileType]) {
            return generateImagesAndUpdateNode(
              node,
              resolve,
              inLink,
              overWrites
            ).then(rawHTML => {
              if (rawHTML) {
                // 画像または ref のノードを、インラインの HTML ノードに置き換える。
                if (refNode) {
                  node = refNode
                }
                node.type = `html`
                node.value = rawHTML
              }

              return resolve(node)
            })
          } else {
            // 画像が相対パスではないので、何もすることがない。
            return resolve()
          }
        })
    )
  ).then(markdownImageNodes =>
    // HTML の画像ノードに関する処理
    Promise.all(
      // HTML ノードは複数の画像を含むことがあるので複雑である
      rawHtmlNodes.map(
        ({ node, inLink }) =>
          // eslint-disable-next-line no-async-promise-executor
          new Promise(async (resolve, reject) => {
            if (!node.value) {
              return resolve()
            }

            const $ = cheerio.load(node.value)
            if ($(`img`).length === 0) {
              // img タグがない
              return resolve()
            }

            const imageRefs = []
            $(`img`).each(function () {
              // eslint-disable-next-line @babel/no-invalid-this
              imageRefs.push($(this))
            })

            for (const thisImg of imageRefs) {
              // 必要な詳細を取得する。
              const formattedImgTag = {}
              formattedImgTag.url = thisImg.attr(`src`)
              formattedImgTag.title = thisImg.attr(`title`)
              formattedImgTag.alt = thisImg.attr(`alt`)

              if (!formattedImgTag.url) {
                return resolve()
              }

              const fileType = getImageInfo(formattedImgTag.url).ext

              // 対応している拡張子だけを変換の対象にする
              if (
                isRelativeUrl(formattedImgTag.url) &&
                supportedExtensions[fileType]
              ) {
                const rawHTML = await generateImagesAndUpdateNode(
                  formattedImgTag,
                  resolve,
                  inLink
                )

                if (rawHTML) {
                  // 画像の文字列を置き換える
                  thisImg.replaceWith(rawHTML)
                } else {
                  return resolve()
                }
              }
            }

            // 画像ノードをインラインの HTML ノードに置き換える。
            node.type = `html`
            node.value = $(`body`).html() // cheerio v1 向けの修正

            return resolve(node)
          })
      )
    ).then(htmlImageNodes =>
      markdownImageNodes.concat(htmlImageNodes).filter(node => !!node)
    )
  )
}
