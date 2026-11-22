const { selectAll } = require(`unist-util-select`)
// TODO(v5): gatsby/sharp を使う
const getSharpInstance = require(`./safe-sharp`)
const axios = require(`axios`)
const _ = require(`lodash`)
const Promise = require(`bluebird`)
const cheerio = require(`cheerio`)
const chalk = require(`chalk`)
const { buildResponsiveSizes } = require(`./utils`)

// 画像が contentful でホストされている場合
// 1. 画像ファイルを見つける
// 2. 画像のサイズを調べる
// 3. レスポンシブ画像のサイズのうち、画像の幅より大きいものを取り除く
// 4. レスポンシブ画像を作成する。
// 5. アスペクト比のヘルパー付きの html を設定する。

module.exports = async (
  {
    files,
    markdownNode,
    markdownAST,
    pathPrefix,
    getNode,
    reporter,
    cache,
    createContentDigest,
  },
  pluginOptions
) => {
  const defaults = {
    maxWidth: 650,
    wrapperStyle: ``,
    backgroundColor: `white`,
    linkImagesToOriginal: true,
    showCaptions: false,
    pathPrefix,
    withWebp: false,
    loading: `lazy`,
  }

  // これは markdown 構文の画像タグでしか動作しない
  const markdownImageNodes = selectAll(`image`, markdownAST)

  // これにより html の image タグも使えるようになる
  const rawHtmlNodes = selectAll(`html`, markdownAST)

  const generateImagesAndUpdateNode = async function (node) {
    let originalImg = node.url
    if (!/^(http|https)?:\/\//i.test(node.url)) {
      originalImg = `https:${node.url}`
    }

    const srcSplit = node.url.split(`/`)
    const fileName = srcSplit[srcSplit.length - 1]
    const options = _.defaults({}, pluginOptions, defaults)

    const optionsHash = createContentDigest(options)

    const cacheKey = `remark-images-ctf-${node.url}-${optionsHash}`
    const cachedRawHTML = await cache.get(cacheKey)

    if (cachedRawHTML) {
      return cachedRawHTML
    }
    const sharp = await getSharpInstance()
    const metaReader = sharp()

    // @todo 信頼性を高めるために、gatsby-source-contentful のアセットダウンロード関数を使うべきである
    let response
    try {
      response = await axios({
        method: `GET`,
        url: originalImg, // なぜか './' というプレフィックスが付いている
        responseType: `stream`,
      })
    } catch (err) {
      reporter.panic(
        `Image downloading failed for ${originalImg}, please check if the image still exists on contentful`,
        err
      )
      return []
    }

    response.data.pipe(metaReader)

    let metadata
    try {
      metadata = await metaReader.metadata()
    } catch (error) {
      console.log(error)
      reporter.panic(
        `The image "${node.url}" (with alt text: "${node.alt}") doesn't appear to be a supported image format.`,
        error
      )
    }

    response.data.destroy()

    const responsiveSizesResult = await buildResponsiveSizes(
      {
        metadata,
        imageUrl: originalImg,
        options,
      },
      reporter
    )

    // paddingBottom の % を計算する
    const ratio = `${(1 / responsiveSizesResult.aspectRatio) * 100}%`

    const fallbackSrc = originalImg
    const srcSet = responsiveSizesResult.srcSet
    const presentationWidth = responsiveSizesResult.presentationWidth

    // デフォルトの alt を生成する
    const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ``)
    const defaultAlt = fileNameNoExt.replace(/[^A-Z0-9]/gi, ` `)

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

    // ベースになる image タグを作成する
    let imageTag = `
      <img
        class="gatsby-resp-image-image"
        style="width: 100%; height: 100%; margin: 0; vertical-align: middle; position: absolute; top: 0; left: 0; box-shadow: inset 0px 0px 0px 400px ${
          options.backgroundColor
        };"
        alt="${node.alt ? node.alt : defaultAlt}"
        title="${node.title ? node.title : ``}"
        src="${fallbackSrc}"
        srcset="${srcSet}"
        sizes="${responsiveSizesResult.sizes}"
        loading="${loading}"
      />
   `.trim()

    // options.withWebp が有効な場合は、webp 版を生成し、image タグを picture タグに変更する
    if (options.withWebp) {
      imageTag = `
        <picture>
          <source
            srcset="${responsiveSizesResult.webpSrcSet}"
            sizes="${responsiveSizesResult.sizes}"
            type="image/webp"
          />
          <source
            srcset="${srcSet}"
            sizes="${responsiveSizesResult.sizes}"
          />
          <img
            class="gatsby-resp-image-image"
            style="width: 100%; height: 100%; margin: 0; vertical-align: middle; position: absolute; top: 0; left: 0; box-shadow: inset 0px 0px 0px 400px ${
              options.backgroundColor
            };"
            alt="${node.alt ? node.alt : defaultAlt}"
            title="${node.title ? node.title : ``}"
            src="${fallbackSrc}"
            loading="${loading}"
          />
        </picture>
      `.trim()
    }

    // アスペクト比のプレースホルダー付きの新しい画像ノードを組み立てる
    let rawHTML = `
      <span
        class="gatsby-resp-image-wrapper"
        style="position: relative; display: block; ${options.wrapperStyle}; max-width: ${presentationWidth}px; margin-left: auto; margin-right: auto;"
      >
        <span
          class="gatsby-resp-image-background-image"
          style="padding-bottom: ${ratio}; position: relative; bottom: 0; left: 0; background-image: url('${responsiveSizesResult.base64}'); background-size: cover; display: block;"
        >
          ${imageTag}
        </span>
      </span>
    `.trim()

    // 元の画像へのリンクを任意にする。
    if (options.linkImagesToOriginal) {
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

    // figure で包み、title をキャプションとして使う

    if (options.showCaptions && node.title) {
      rawHTML = `
<figure class="gatsby-resp-image-figure">
${rawHTML}
<figcaption class="gatsby-resp-image-figcaption">${node.title}</figcaption>
</figure>`
    }
    await cache.set(cacheKey, rawHTML)
    return rawHTML
  }
  return Promise.all(
    // markdown には入れ子がないので単純である
    markdownImageNodes.map(
      node =>
        new Promise(resolve => {
          if (node.url.indexOf(`images.ctfassets.net`) !== -1) {
            return generateImagesAndUpdateNode(node).then(rawHTML => {
              if (rawHTML) {
                // 画像ノードをインラインの HTML ノードに置き換える。
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
        node =>
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

              if (formattedImgTag.url.indexOf(`images.ctfassets.net`) !== -1) {
                const rawHTML = await generateImagesAndUpdateNode(
                  formattedImgTag,
                  resolve
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
