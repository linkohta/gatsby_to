/* eslint-disable no-useless-escape */
import { isWebUri } from "valid-url"
import { GatsbyImage } from "gatsby-plugin-image"
import React from "react"
import ReactDOMServer from "react-dom/server"
import stringify from "fast-json-stable-stringify"
import execall from "execall"
import cheerio from "cheerio"
import url from "url"
import path from "path"
import fs from "fs-extra"
import { supportedExtensions } from "gatsby-transformer-sharp/supported-extensions"
import replaceAll from "replaceall"
import { usingGatsbyV4OrGreater } from "~/utils/gatsby-version"
import {
  gatsbyImageResolver,
  publicUrlResolver,
} from "gatsby-plugin-utils/polyfill-remote-file"

import { formatLogMessage } from "~/utils/format-log-message"

import fetchReferencedMediaItemsAndCreateNodes, {
  stripImageSizesFromUrl,
} from "../fetch-nodes/fetch-referenced-media-items"
import { b64e } from "~/utils/string-encoding"
import { getStore } from "~/store"

import { store as gatsbyStore } from "gatsby/dist/redux"

/**
 * WPGraphQL の MediaItem ノードと Gatsby のプラグインオプションを受け取り、GatsbyImage 用の正しいプレースホルダーの URL を返す
 *
 * ユーザーはプラグインオプションの placeholderSizeName を設定するか、WP で `gatsby-image-placeholder` という名前の画像サイズを作成しなければならない
 */
export function getPlaceholderUrlFromMediaItemNode(node, pluginOptions) {
  let placeholderSizeByWidth
  let placeholderSizeByName

  node.mediaDetails?.sizes?.forEach(size => {
    if (
      size.name ===
      (pluginOptions?.type?.MediaItem?.placeholderSizeName ||
        `gatsby-image-placeholder`)
    ) {
      placeholderSizeByName = size
    } else if (Number(size.width) <= 20) {
      placeholderSizeByWidth = size
    }
  })

  const placeHolderSize = placeholderSizeByName || placeholderSizeByWidth

  return placeHolderSize?.sourceUrl
}

const findReferencedImageNodeIds = ({ nodeString, pluginOptions, node }) => {
  // プラグインオプションの lazyNodes が設定されている場合は、画像ノードの id を
  // 探す必要はない。それらのノードはリゾルバーで遅延取得されるためである。
  if (
    pluginOptions.type.MediaItem.lazyNodes &&
    // ただし Gatsby v4 以降は別である。lazyNodes が使えなくなったためである
    !usingGatsbyV4OrGreater
  ) {
    return []
  }

  // 参照されているすべてのメディアファイルの ID の配列を取得する
  const matchedIds = execall(
    /"__typename":"MediaItem","id":"([^"]*)"/gm,
    nodeString
  )
    .map(match => match.subMatches[0])
    .filter(id => id !== node.id)

  return matchedIds
}

const getCheerioImgDbId = cheerioImg => {
  // data 属性から db の id を取得してみる
  const dataAttributeId =
    cheerioImg.attribs[`data-id`] || cheerioImg.attribs[`data-image-id`]

  if (dataAttributeId) {
    return dataAttributeId
  }

  if (!cheerioImg.attribs.class) {
    return null
  }

  // クラス名 wp-image-id から db の id を取得してみる
  const wpImageClass = cheerioImg.attribs.class
    .split(` `)
    .find(className => className.includes(`wp-image-`))

  if (wpImageClass) {
    const wpImageClassDashArray = wpImageClass.split(`-`)
    const wpImageClassId = Number(
      wpImageClassDashArray[wpImageClassDashArray.length - 1]
    )

    if (wpImageClassId) {
      return wpImageClassId
    }
  }

  return null
}

// メディアアイテムは "post" タイプである
const dbIdToMediaItemRelayId = dbId => (dbId ? b64e(`post:${dbId}`) : null)

const getCheerioImgRelayId = cheerioImg =>
  dbIdToMediaItemRelayId(getCheerioImgDbId(cheerioImg))

export const ensureSrcHasHostname = ({ src, wpUrl }) => {
  const { protocol, host } = url.parse(wpUrl)

  if (src.startsWith(`/wp-content`)) {
    src = `${protocol}//${host}${src}`
  }

  return src
}

const pickNodeBySourceUrlOrCheerioImg = ({
  url,
  cheerioImg,
  mediaItemNodes,
}) => {
  const possibleHtmlSrcs = [
    // 元の html の src から、メディアアイテムのソース URL との一致を試みる
    url,
    // または、画像サイズの文字列を取り除いた src で試みる
    stripImageSizesFromUrl(url),
  ]

  let imageNode = mediaItemNodes.find(
    mediaItemNode =>
      // ソース URL でノードを探すか
      possibleHtmlSrcs.includes(mediaItemNode.sourceUrl) ||
      possibleHtmlSrcs.includes(
        // sourceUrl から -scaled を除いたものでも一致を試みる
        // WP は、アップロード時に大きすぎた画像の URL に -scaled を付けるが、
        // html 内の画像の URL にはその制約がないためである。
        // sourceUrl に -scaled が含まれていても、フルサイズの画像は
        // サーバーに保存されたままである（db にはない）
        (mediaItemNode.sourceUrl || mediaItemNode.mediaItemUrl)?.replace(
          `-scaled`,
          ``
        )
      )
  )

  if (!imageNode && cheerioImg) {
    imageNode = mediaItemNodes.find(
      mediaItemNode => getCheerioImgRelayId(cheerioImg) === mediaItemNode.id
    )
  }

  return imageNode
}

let displayedFailedToRestoreMessage = false

const fetchNodeHtmlImageMediaItemNodes = async ({
  // node, // for inspecting nodes while debugging
  cheerioImages,
  helpers,
  wpUrl,
}) => {
  // ほかの場所でキャッシュした画像ノードをすべて取得する
  const { nodeMetaByUrl } = getStore().getState().imageNodes

  const previouslyCachedNodesByUrl = (
    await Promise.all(
      Object.entries(nodeMetaByUrl).map(([sourceUrl, { id } = {}]) => {
        if (!sourceUrl || !id) {
          return null
        }

        sourceUrl = ensureSrcHasHostname({ wpUrl, src: sourceUrl })

        const existingNode = helpers.getNode(id)

        if (!existingNode) {
          if (!displayedFailedToRestoreMessage) {
            helpers.reporter.warn(
              formatLogMessage(
                `File node failed to restore from cache. This is a bug in gatsby-source-wordpress. Please open an issue so we can help you out :)`
              )
            )
            displayedFailedToRestoreMessage = true
          }

          return null
        }

        return {
          sourceUrl,
          ...existingNode,
        }
      })
    )
  ).filter(Boolean)

  const mediaItemUrls = cheerioImages
    // すでに持っているノードを除外する
    .filter(({ cheerioImg }) => {
      const url = ensureSrcHasHostname({ wpUrl, src: cheerioImg.attribs.src })

      const existingNode = pickNodeBySourceUrlOrCheerioImg({
        url,
        mediaItemNodes: previouslyCachedNodesByUrl,
      })

      return !existingNode
    })
    // 残りの URL を取得する
    .map(({ cheerioImg }) => {
      const src = ensureSrcHasHostname({
        src: cheerioImg.attribs.src,
        wpUrl,
      })

      return src
    })

  // まだ持っていないメディアアイテムをすべて取得するクエリを組み立てる
  const mediaItemNodesBySourceUrl =
    await fetchReferencedMediaItemsAndCreateNodes({
      mediaItemUrls,
    })
  // 投稿や固定ページにアップロードした後でメディアライブラリから編集された画像は、
  // sourceUrl が変わるので、sourceUrl では取得できない
  // 多くの場合、img には data-id または data-image-id が属性として付いている
  // それらを使ってメディアアイテムのノードを取得することもできる
  // こうすることで、ノードの取りこぼしを防げる
  const mediaItemDbIds = cheerioImages
    .map(({ cheerioImg }) => getCheerioImgDbId(cheerioImg))
    .filter(Boolean)

  const mediaItemRelayIds = mediaItemDbIds
    .map(dbId => dbIdToMediaItemRelayId(dbId))
    .filter(
      // すでに取得したメディアアイテムの id を除外する
      relayId =>
        ![...mediaItemNodesBySourceUrl, ...previouslyCachedNodesByUrl].find(
          ({ id } = {}) => id === relayId
        )
    )

  const mediaItemNodesById = await fetchReferencedMediaItemsAndCreateNodes({
    referencedMediaItemNodeIds: mediaItemRelayIds,
  })

  const createdNodes = [...mediaItemNodesById, ...mediaItemNodesBySourceUrl]

  const mediaItemNodes = [...createdNodes, ...previouslyCachedNodesByUrl]

  const htmlMatchesToMediaItemNodesMap = new Map()
  for (const { cheerioImg, match } of cheerioImages) {
    const htmlImgSrc = ensureSrcHasHostname({
      src: cheerioImg.attribs.src,
      wpUrl,
    })

    const imageNode = pickNodeBySourceUrlOrCheerioImg({
      url: htmlImgSrc,
      cheerioImg,
      mediaItemNodes,
    })

    cacheCreatedFileNodeBySrc({ node: imageNode, src: htmlImgSrc })

    if (imageNode) {
      // match は img タグの html 文字列である
      htmlMatchesToMediaItemNodesMap.set(match, { imageNode, cheerioImg })
    }
  }

  return htmlMatchesToMediaItemNodesMap
}

const getCheerioElementFromMatch =
  wpUrl =>
  ({ match, tag = `img` }) => {
    // 引用符のエスケープを解除する
    const parsedMatch = JSON.parse(`"${match}"`)

    // 一致した img タグを cheerio に読み込む
    const $ = cheerio.load(parsedMatch, {
      xml: {
        // <body></body> で包まれないようにする
        withDomLvl1: false,
        // ここで扱うのは 1 つの要素だけなので、空白を正規化する必要はない
        normalizeWhitespace: false,
        xmlMode: true,
        // エンティティのデコードはここでの役割ではない。WPGQL か、
        // ソースプラグインの別の箇所が担当する。
        decodeEntities: false,
      },
    })

    // match は 1 つのタグにしか一致しないので、要素は常に 1 つだけである
    // $(tag) は配列ではなく、キー 0 を持つオブジェクトである
    const cheerioElement = $(tag)[0]

    if (cheerioElement?.attribs?.src?.startsWith(`/wp-content`)) {
      cheerioElement.attribs.src = `${wpUrl}${cheerioElement.attribs.src}`
    }

    return {
      match,
      cheerioElement,
      // @todo これは、この関数が画像にしか使われていなかったころの名残である
      // リファクタリングして取り除く
      cheerioImg: cheerioElement,
    }
  }

const getCheerioElementsFromMatches = ({ imgTagMatches, wpUrl }) =>
  imgTagMatches
    .map(getCheerioElementFromMatch(wpUrl))
    .filter(({ cheerioImg: { attribs } }) => {
      if (!attribs.src) {
        return false
      }

      return isWebUri(encodeURI(attribs.src))
    })

const getLargestSizeFromSizesAttribute = sizesString => {
  const sizesStringsArray = sizesString.split(`,`)

  return sizesStringsArray.reduce((largest, currentSizeString) => {
    const maxWidth = currentSizeString
      .substring(
        currentSizeString.indexOf(`max-width: `) + 1,
        currentSizeString.indexOf(`px`)
      )
      .trim()

    const maxWidthNumber = Number(maxWidth)
    const noLargestAndMaxWidthIsANumber = !largest && !isNaN(maxWidthNumber)
    const maxWidthIsALargerNumberThanLargest =
      largest && !isNaN(maxWidthNumber) && maxWidthNumber > largest

    if (noLargestAndMaxWidthIsANumber || maxWidthIsALargerNumberThanLargest) {
      largest = maxWidthNumber
    }

    return largest
  }, null)
}

const findImgTagMaxWidthFromCheerioImg = cheerioImg => {
  const {
    attribs: { width, sizes },
  } = cheerioImg || { attribs: { width: null, sizes: null } }

  if (width) {
    const widthNumber = Number(width)

    if (!isNaN(widthNumber)) {
      return widthNumber
    }
  }

  if (sizes) {
    const largestSize = getLargestSizeFromSizesAttribute(sizes)

    if (largestSize && !isNaN(largestSize)) {
      return largestSize
    }
  }

  return null
}

const getFileNodeRelativePathname = fileNode => {
  const fileName = `${fileNode.internal.contentDigest}/${fileNode.base}`

  return fileName
}

const getFileNodePublicPath = fileNode => {
  const fileName = getFileNodeRelativePathname(fileNode)

  const publicPath = path.join(process.cwd(), `public`, `static`, fileName)

  return publicPath
}

const copyFileToStaticAndReturnUrlPath = async (fileNode, helpers) => {
  const publicPath = getFileNodePublicPath(fileNode)

  if (!fs.existsSync(publicPath)) {
    await fs.copy(
      fileNode.absolutePath,
      publicPath,
      { dereference: true },
      err => {
        if (err) {
          console.error(
            `error copying file from ${fileNode.absolutePath} to ${publicPath}`,
            err
          )
        }
      }
    )
  }

  const fileName = getFileNodeRelativePathname(fileNode)

  const relativeUrl = `${helpers.pathPrefix ?? ``}/static/${fileName}`

  return relativeUrl
}

const cacheCreatedFileNodeBySrc = ({ node, src }) => {
  if (node) {
    // 取得したメディアアイテムを、グローバルのメディアアイテムのキャッシュに保存する
    getStore().dispatch.imageNodes.pushNodeMeta({
      sourceUrl: src,
      id: node.id,
      modifiedGmt: node.modifiedGmt,
    })
  }
}

const imgSrcRemoteFileRegex =
  /(?:src=\\")((?:(?:https?|ftp|file):\/\/|www\.|ftp\.|\/)(?:[^'"])*\.(?:jpeg|jpg|png|gif|ico|mpg|ogv|svg|bmp|tif|tiff))(\?[^\\" \.]*|)(?=\\"| |\.)/gim

export const getImgSrcRemoteFileMatchesFromNodeString = nodeString =>
  execall(imgSrcRemoteFileRegex, nodeString).filter(({ subMatches }) => {
    // match が JSON エンコードされている場合は、JSON エンコードされた
    // 文字列フィールドの中にあることを意味する。
    const isInJSON = subMatches[0].includes(`\\/\\/`)

    // エンコードされた JSON は処理すべきではないので、JSON であればこの match をスキップする
    return !isInJSON
  })

export const getImgTagMatches = ({ nodeString }) =>
  execall(
    /<img([\w\W]+?)[\/]?>/gim,
    nodeString
      // pre の中の画像には一致させたくない
      .replace(/<pre([\w\W]+?)[\/]?>(?:(?!<\/pre>).)+(<\/pre>)/gim, ``)
      // code タグの中も同様なので、これらのタグとその中身をすべて一時的に取り除く
      .replace(/<code([\w\W]+?)[\/]?>(?:(?!<\/code>).)+(<\/code>)/gim, ``)
  )

export const replaceNodeHtmlImages = async ({
  nodeString,
  node,
  helpers,
  wpUrl,
  pluginOptions,
}) => {
  // これにより、html にインラインで埋め込まれた画像を取得しないようにする
  if (
    !pluginOptions?.html?.useGatsbyImage ||
    pluginOptions?.type?.MediaItem?.exclude
  ) {
    return nodeString
  }

  const imageUrlMatches = getImgSrcRemoteFileMatchesFromNodeString(nodeString)

  const imgTagMatches = getImgTagMatches({ nodeString })

  if (imageUrlMatches.length && imgTagMatches.length) {
    const cheerioImages = getCheerioElementsFromMatches({
      imgTagMatches,
      wpUrl,
    })

    const htmlMatchesToMediaItemNodesMap =
      await fetchNodeHtmlImageMediaItemNodes({
        cheerioImages,
        nodeString,
        node,
        helpers,
        pluginOptions,
        wpUrl,
      })

    // cheerioImage ごとに gatsby の画像を生成する
    const htmlMatchesWithImageResizes = await Promise.all(
      imgTagMatches.map(async ({ match }) => {
        const matchInfo = htmlMatchesToMediaItemNodesMap.get(match)

        if (!matchInfo) {
          return null
        }

        const { imageNode, cheerioImg } = matchInfo

        const isMediaItemNode = imageNode.__typename === `MediaItem`

        if (!imageNode) {
          return null
        }

        const fileNode =
          // WPGQL でこの画像の MediaItem ノードを取得できなかった場合
          !isMediaItemNode
            ? // これはすでにファイルノードである
              imageNode
            : // そうでなければファイルノードを取得する
              helpers.getNode(imageNode?.localFile?.id)

        const extension = imageNode?.mimeType?.replace(
          `${imageNode?.mediaType}/`,
          ``
        )

        const imgTagMaxWidth = findImgTagMaxWidthFromCheerioImg(cheerioImg)

        const mediaItemNodeWidth = isMediaItemNode
          ? imageNode?.mediaDetails?.width
          : null

        // html から最大幅を推定できない場合は、この値が Sharp に渡される
        let fallbackImageMaxWidth = pluginOptions?.html?.fallbackImageMaxWidth

        if (
          // 画像がフォールバックの最大幅より小さい場合、
          // メディアアイテムのノードがあれば、代わりに画像の幅が使われる
          fallbackImageMaxWidth > mediaItemNodeWidth &&
          // もちろん、そのためにはメディアアイテムのノードと、
          // メディアアイテムのノードの最大幅が必要である
          mediaItemNodeWidth &&
          typeof mediaItemNodeWidth === `number` &&
          mediaItemNodeWidth > 0
        ) {
          fallbackImageMaxWidth = mediaItemNodeWidth
        }

        let maxWidth =
          // html から最大幅を推定できた場合
          (imgTagMaxWidth &&
          // かつ、フルサイズの最大幅が分かるメディアアイテムのノードがある場合
          mediaItemNodeWidth &&
          // かつ、最大幅を持たない svg ではない場合
          extension !== `svg` &&
          // かつ、メディアアイテムのノードの最大幅が、html から推定した値より
          // 小さい場合
          mediaItemNodeWidth < imgTagMaxWidth
            ? // メディアアイテムのノードの幅を使う
              mediaItemNodeWidth
            : // そうでなければ、html から推定した幅を使う
              imgTagMaxWidth) ??
          // メディアアイテムのノードがなく、html からも幅を推定できなかった場合は、
          // プラグインオプションのフォールバックの最大幅を使う
          fallbackImageMaxWidth

        const configuredMaxWidth = pluginOptions?.html?.imageMaxWidth

        // 設定された html.maxWidth プロパティが結果より小さい場合は、
        // 結果の幅を上書きする
        if (configuredMaxWidth && configuredMaxWidth < maxWidth) {
          maxWidth = configuredMaxWidth
        }

        const quality = pluginOptions?.html?.imageQuality ?? 70

        const { reporter } = helpers

        const gatsbyTransformerSharpSupportsThisFileType =
          supportedExtensions[extension] || extension === `gif`

        let imageResize = null
        let publicUrl

        const imageUrl =
          imageNode.mediaItemUrl || imageNode.sourceUrl || imageNode.url

        try {
          if (gatsbyTransformerSharpSupportsThisFileType) {
            const placeholderUrl = getPlaceholderUrlFromMediaItemNode(
              imageNode,
              pluginOptions
            )

            const formats = [`auto`]
            if (pluginOptions.html.generateWebpImages) {
              formats.push(`webp`)
            }
            if (pluginOptions.html.generateAvifImages) {
              formats.push(`avif`)
            }

            imageResize = await gatsbyImageResolver(
              {
                url: imageUrl,
                placeholderUrl,
                mimeType: imageNode.mimeType,
                width: imageNode.mediaDetails.width,
                height: imageNode.mediaDetails.height,
                filename: path.basename(imageNode.mediaDetails.file),
                internal: {
                  contentDigest: imageNode.modifiedGmt,
                },
              },
              {
                width: maxWidth,
                layout: `constrained`,
                placeholder: !placeholderUrl
                  ? `none`
                  : pluginOptions?.html?.placeholderType || `dominantColor`,
                quality,
                formats,
              },
              helpers.actions,
              gatsbyStore
            )
          } else {
            publicUrl = publicUrlResolver(
              {
                url: imageUrl,
                mimeType: imageNode.mimeType,
                filename: path.basename(imageNode.sourceUrl || imageNode.url),
                internal: {
                  contentDigest: imageNode.modifiedGmt,
                },
              },
              helpers.actions,
              gatsbyStore
            )
          }
        } catch (e) {
          reporter.error(e)
          reporter.warn(
            formatLogMessage(
              `${node.__typename} ${node.id} couldn't process inline html image ${imageUrl}`
            )
          )
          return null
        }

        return {
          match,
          cheerioImg,
          fileNode,
          imageResize,
          maxWidth,
          publicUrl,
        }
      })
    )

    // nodeString を検索して置き換え、一致した画像を、描画済みの gatsby の画像に置き換える
    let replaceIndex = 0
    for (const matchResize of htmlMatchesWithImageResizes) {
      if (!matchResize) {
        continue
      }

      const { match, imageResize, cheerioImg, publicUrl } = matchResize

      let ReactGatsbyImage
      // 画像のハイドレーション用データを作るために使う
      let gatsbyImageHydrationData = null
      if (
        imageResize &&
        (imageResize.images.sources.length > 0 || imageResize.images.fallback)
      ) {
        gatsbyImageHydrationData = {
          image: imageResize,
          // Wordpress は、装飾目的の画像では "alt" を空にするようユーザーに案内している。しかし返ってくるのは `` ではなく undefined である
          alt: cheerioImg?.attribs?.alt ?? ``,
          className: `${
            cheerioImg?.attribs?.class || ``
          } inline-gatsby-image-wrapper`,
          "data-wp-inline-image": String(++replaceIndex),
        }
        ReactGatsbyImage = React.createElement(
          GatsbyImage,
          gatsbyImageHydrationData,
          null
        )
      } else if (publicUrl) {
        ReactGatsbyImage = React.createElement(
          `img`,
          {
            src: publicUrl,
            // Wordpress は、装飾目的の画像では "alt" を空にするようユーザーに案内している。しかし返ってくるのは `` ではなく undefined である
            alt: cheerioImg?.attribs?.alt ?? ``,
            className: `${
              cheerioImg?.attribs?.class || ``
            } inline-gatsby-image-wrapper`,
          },
          null
        )
      }

      if (ReactGatsbyImage) {
        let gatsbyImageStringRaw =
          ReactDOMServer.renderToString(ReactGatsbyImage)

        // gatsby-plugin-image がナビゲーション時に動くには、ハイドレーション用データが必要である。gatsby-browser.ts で使えるよう、そのデータを DOM に追加する
        if (gatsbyImageHydrationData) {
          gatsbyImageStringRaw += `<script type="application/json" data-wp-inline-image-hydration="${replaceIndex}">${JSON.stringify(
            gatsbyImageHydrationData
          )}</script>`
        }
        // この JSON 文字列を、より大きな JSON オブジェクトの文字列の中へ戻すので、
        // 画像を囲む JSON stringify の引用符を取り除く必要がある
        const gatsbyImageStringJSON = JSON.stringify(gatsbyImageStringRaw)
        const gatsbyImageString = gatsbyImageStringJSON.substring(
          1,
          gatsbyImageStringJSON.length - 1
        )

        nodeString = replaceAll(match, gatsbyImageString, nodeString)
      }
    }
  }

  return nodeString
}

const replaceFileLinks = async ({
  nodeString,
  helpers,
  wpUrl,
  pluginOptions,
  node,
}) => {
  if (
    !pluginOptions?.html?.createStaticFiles ||
    pluginOptions?.type?.MediaItem?.exclude
  ) {
    return nodeString
  }

  if (node.__typename === `MediaItem`) {
    // MediaItem ノードのファイルリンクは置き換えない。ほかのノードタイプとは別の特別な処理をしているためである。
    // ここでファイルリンクを置き換えると、localFile ノードを正しく取得できなくなる
    return nodeString
  }

  const hrefMatches = [
    // html フィールド内の URL の pathname に一致させる。例: /wp-content/uploads/2019/01/image.jpg
    ...(execall(
      /(\\"|\\'|\()([^'"()]*)(\/wp-content\/uploads\/[^'">()]+)(\\"|\\'|>|\))/gm,
      nodeString
    ) || []),
    // json フィールド内の完全な URL に一致させる。例: https://example.com/wp-content/uploads/2019/01/image.jpg
    ...(execall(
      new RegExp(
        `(\\"|\\'|\\()([^'"()]*)(${wpUrl}\/wp-content\/uploads\/[^'">()]+)(\\"|\\'|>|\\))`,
        `gm`
      ),
      nodeString
    ) || []),
  ]

  if (hrefMatches.length) {
    // eslint-disable-next-line arrow-body-style
    const mediaItemUrlsAndMatches = hrefMatches.map(matchGroup => {
      const match = matchGroup.subMatches[2]
      const url = match.startsWith(wpUrl) ? match : `${wpUrl}${match}`
      return {
        matchGroup,
        url,
      }
    })

    const mediaItemUrls = mediaItemUrlsAndMatches
      .map(({ url }) => url)
      .filter(isWebUri)

    const mediaItemNodesBySourceUrl =
      await fetchReferencedMediaItemsAndCreateNodes({
        mediaItemUrls,
      })

    const findReplaceMaps = []

    await Promise.all(
      mediaItemNodesBySourceUrl.map(async node => {
        let fileNode
        let mediaItemNode

        if (node.internal.type === `File`) {
          fileNode = node
          mediaItemNode = await helpers.getNode(node.parent)
        } else if (node.localFile?.id) {
          fileNode = await helpers.getNode(node.localFile.id)
          mediaItemNode = node
        } else {
          return null
        }

        const relativeUrl = await copyFileToStaticAndReturnUrlPath(
          fileNode,
          helpers
        )

        if (!relativeUrl || !mediaItemNode?.mediaItemUrl || !fileNode) {
          return null
        }

        const mediaItemMatchGroup = mediaItemUrlsAndMatches.find(
          ({
            matchGroup: {
              subMatches: [, , path],
            },
          }) => mediaItemNode.mediaItemUrl.includes(path)
        )?.matchGroup

        if (!mediaItemMatchGroup) {
          return null
        }

        const [, hostname, path] = mediaItemMatchGroup.subMatches

        cacheCreatedFileNodeBySrc({
          node: mediaItemNode,
          src: `${wpUrl}${path}`,
        })

        findReplaceMaps.push({
          find: `${hostname || ``}${path}`,
          replace: relativeUrl,
        })

        findReplaceMaps.push({
          find: path,
          replace: relativeUrl,
        })

        return null
      })
    )

    for (const { find, replace } of findReplaceMaps.filter(Boolean)) {
      nodeString = replaceAll(find, replace, nodeString)
    }
  }

  return nodeString
}

export const getWpLinkRegex = wpUrl =>
  new RegExp(
    `["']${wpUrl}(?!/wp-content|/wp-admin|/wp-includes)(/[^'"]+)["']`,
    `gim`
  )

// WP のフロントエンドの URL を、相対パスに置き換える
const replaceNodeHtmlLinks = ({ wpUrl, nodeString, node }) => {
  const wpLinkRegex = getWpLinkRegex(wpUrl)
  const linkMatches = execall(wpLinkRegex, nodeString)

  if (linkMatches.length) {
    linkMatches.forEach(({ match, subMatches: [path] }) => {
      if (path) {
        try {
          // match から \、"、' の文字を取り除く
          const normalizedMatch = match
            .replace(/['"\\]/g, ``)
            // クエリパラメーターが正しく引用符で囲まれるようにする
            .replace(/\?/, `\\?`)

          const normalizedPath = path.replace(/\\/g, ``)

          // 正規化した match を相対パスに置き換える
          const thisMatchRegex = new RegExp(
            normalizedMatch + `(?!/?wp-content|/?wp-admin|/?wp-includes)`,
            `g`
          )

          nodeString = nodeString.replace(thisMatchRegex, normalizedPath)
        } catch (e) {
          console.error(e)
          console.warn(
            formatLogMessage(
              `Failed to process inline html links in ${node.__typename} ${node.id}`
            )
          )
        }
      }
    })
  }

  return nodeString
}

// 特定の文字列または正規表現を、プラグインオプションの設定で指定された文字列に置き換える
export const searchAndReplaceNodeStrings = ({
  nodeString,
  node,
  pluginOptions,
}) => {
  if (Array.isArray(pluginOptions?.searchAndReplace)) {
    pluginOptions.searchAndReplace.forEach(({ search, replace }) => {
      const searchRegex = new RegExp(search, `g`)

      const stringMatches = execall(searchRegex, nodeString)

      if (stringMatches.length) {
        stringMatches.forEach(({ match }) => {
          if (match) {
            try {
              nodeString = nodeString.replace(search, replace)
            } catch (e) {
              console.error(e)
              console.warn(
                formatLogMessage(
                  `Failed to process search and replace string in ${node.__typename} ${node.id}`
                )
              )
            }
          }
        })
      }
    })
  }

  return nodeString
}

const processNodeString = async ({
  nodeString,
  node,
  pluginOptions,
  helpers,
  wpUrl,
}) => {
  const nodeStringFilters = [
    searchAndReplaceNodeStrings,
    replaceNodeHtmlImages,
    replaceFileLinks,
    replaceNodeHtmlLinks,
  ]

  for (const nodeStringFilter of nodeStringFilters) {
    nodeString = await nodeStringFilter({
      nodeString,
      node,
      pluginOptions,
      helpers,
      wpUrl,
    })
  }

  return nodeString
}

const processNode = async ({
  node,
  pluginOptions,
  wpUrl,
  helpers,
  referencedMediaItemNodeIds,
}) => {
  const nodeString = stringify(node)

  // 参照されているノードの id を探す
  // ここでは、ノードの中にあるノード id の文字列を検索している
  // これを使って、投稿で使われているメディアアイテムだけを
  // ダウンロードする
  // これは、ノードのフィールドのどこかでつながっている画像ノードを
  // ダウンロードするうえで重要である
  const nodeMediaItemIdReferences = findReferencedImageNodeIds({
    nodeString,
    pluginOptions,
    node,
  })

  // 参照されている id のストアに追加する
  if (nodeMediaItemIdReferences?.length && referencedMediaItemNodeIds) {
    nodeMediaItemIdReferences.forEach(id => referencedMediaItemNodeIds.add(id))
  }

  const processedNodeString = await processNodeString({
    nodeString,
    node,
    pluginOptions,
    helpers,
    wpUrl,
  })

  const processedNode =
    // nodeString が変わった場合にだけ解析する
    processedNodeString !== nodeString ? JSON.parse(processedNodeString) : node

  return {
    processedNode,
    nodeMediaItemIdReferences,
  }
}

export { processNode }
