/* eslint-disable @babel/no-invalid-this */
const visit = require(`unist-util-visit`)
// is-relative-url 4 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: isRelativeUrl } = require(`is-relative-url`)
const fsExtra = require(`fs-extra`)
const path = require(`path`)
const _ = require(`lodash`)
const cheerio = require(`cheerio`)
const imageSize = require(`probe-image-size`)

const DEPLOY_DIR = `public`

const invalidDestinationDirMessage = dir =>
  `[gatsby-remark-copy-linked-files You have supplied an invalid destination directory. The destination directory must be a child but was: ${dir}`

// dest は子でなければならない
const destinationIsValid = dest => !path.relative(`./`, dest).startsWith(`..`)

const validateDestinationDir = dir => {
  if (typeof dir === `undefined`) {
    return true
  } else if (typeof dir === `string`) {
    // 検証が動作するよう、ダミーのデータを渡す必要がある
    return destinationIsValid(`${dir}/n/h/a`)
  } else if (_.isFunction(dir)) {
    // 検証が動作するよう、ダミーのデータを渡す必要がある
    return destinationIsValid(
      `${dir({ name: `n`, hash: `h`, absolutePath: `a` })}`
    )
  } else {
    return false
  }
}

const defaultDestination = linkNode =>
  `${linkNode.internal.contentDigest}/${linkNode.name}.${linkNode.extension}`

const getDestination = (linkNode, dir) => {
  if (_.isFunction(dir)) {
    return `${dir({
      name: linkNode.name,
      hash: linkNode.internal.contentDigest,
      absolutePath: linkNode.absolutePath,
    })}.${linkNode.extension}`
  } else if (_.isString(dir)) {
    return `${dir}/${defaultDestination(linkNode)}`
  } else {
    return defaultDestination(linkNode)
  }
}

const newPath = (linkNode, options) => {
  const { destinationDir } = options
  const destination = getDestination(linkNode, destinationDir)
  const paths = [process.cwd(), DEPLOY_DIR, destination]
  return path.posix.join(...paths)
}

const newLinkURL = (linkNode, options, pathPrefix) => {
  const { destinationDir } = options
  const destination = getDestination(linkNode, destinationDir)
  const startsWithSlash = destination.startsWith(`/`)
  return `${pathPrefix ? pathPrefix : ``}${
    startsWithSlash ? `` : `/`
  }${destination}`
}

function toArray(buf) {
  const arr = new Array(buf.length)

  for (let i = 0; i < buf.length; i++) {
    arr[i] = buf[i]
  }

  return arr
}

module.exports = (
  { files, markdownNode, markdownAST, pathPrefix, getNode },
  pluginOptions = {}
) => {
  const defaults = {
    ignoreFileExtensions: [`png`, `jpg`, `jpeg`, `bmp`, `tiff`],
  }
  const { destinationDir } = pluginOptions
  if (!validateDestinationDir(destinationDir))
    return Promise.reject(invalidDestinationDirMessage(destinationDir))

  const options = _.defaults({}, pluginOptions, defaults)

  const filesToCopy = new Map()
  // リンクされたファイルを出力先のディレクトリへコピーし、AST がファイルの
  // 新しい場所を指すよう変更する。
  const visitor = link => {
    if (isRelativeUrl(link.url) && getNode(markdownNode.parent).dir) {
      const linkPath = path.posix.join(
        getNode(markdownNode.parent).dir,
        link.url
      )
      const linkNode = _.find(files, file => {
        if (file && file.absolutePath) {
          return file.absolutePath === linkPath
        }
        return null
      })
      if (linkNode && linkNode.absolutePath) {
        const newFilePath = newPath(linkNode, options)

        // 不要なコピーを防ぐ
        if (linkPath === newFilePath) return

        const linkURL = newLinkURL(linkNode, options, pathPrefix)
        link.url = linkURL
        filesToCopy.set(linkPath, newFilePath)
      }
    }
  }

  // ノードを受け取って必要な画像を生成し、
  // 画像を置き換えるための HTML を返す
  const generateImagesAndUpdateNode = function (image, node) {
    const imagePath = path.posix.join(
      getNode(markdownNode.parent).dir,
      image.attr(`src`)
    )
    const imageNode = _.find(files, file => {
      if (file && file.absolutePath) {
        return file.absolutePath === imagePath
      }
      return null
    })
    if (!imageNode || !imageNode.absolutePath) {
      return
    }

    const initialImageSrc = image.attr(`src`)
    // link オブジェクトは新しい場所を指すよう変更されるので、
    // そのデータを使って ref を更新する
    const link = { url: image.attr(`src`) }
    visitor(link)
    node.value = node.value.replace(
      new RegExp(image.attr(`src`), `g`),
      link.url
    )

    let dimensions

    if (!image.attr(`width`) || !image.attr(`height`)) {
      dimensions = imageSize.sync(
        toArray(fsExtra.readFileSync(imageNode.absolutePath))
      )
    }

    // デフォルトの alt を生成する
    const srcSplit = initialImageSrc.split(`/`)
    const fileName = srcSplit[srcSplit.length - 1]
    const fileNameNoExt = fileName.replace(/\.[^/.]+$/, ``)
    const defaultAlt = fileNameNoExt.replace(/[^A-Z0-9]/gi, ` `)

    image.attr(`alt`, image.attr(`alt`) ? image.attr(`alt`) : defaultAlt)
    image.attr(
      `width`,
      image.attr(`width`) ? image.attr(`width`) : dimensions.width
    )
    image.attr(
      `height`,
      image.attr(`height`) ? image.attr(`height`) : dimensions.height
    )
  }

  visit(markdownAST, `link`, link => {
    const ext = link.url.split(`.`).pop()
    if (options.ignoreFileExtensions.includes(ext)) {
      return
    }

    visitor(link)
  })

  visit(markdownAST, `definition`, definition => {
    const ext = definition.url.split(`.`).pop()
    if (options.ignoreFileExtensions.includes(ext)) {
      return
    }

    visitor(definition)
  })

  // これは markdown の img タグでしか動作しない
  visit(markdownAST, `image`, image => {
    const ext = image.url.split(`.`).pop()
    if (options.ignoreFileExtensions.includes(ext)) {
      return
    }

    // 親ノードが dir を持っていることだけを確認する
    if (markdownNode.parent && !getNode(markdownNode.parent).dir) {
      return
    }

    const imagePath = path.posix.join(
      getNode(markdownNode.parent).dir,
      image.url
    )
    const imageNode = _.find(files, file => {
      if (file && file.absolutePath) {
        return file.absolutePath === imagePath
      }
      return false
    })

    if (imageNode) {
      visitor(image)
    }
  })

  // 各 HTML ノードについて
  visit(markdownAST, [`html`, `jsx`], node => {
    const $ = cheerio.load(node.value)

    function processUrl({ url, isRequired }) {
      try {
        const ext = url.split(`.`).pop()
        if (!options.ignoreFileExtensions.includes(ext) || isRequired) {
          // link オブジェクトは新しい場所を指すよう変更されるので、
          // そのデータを使って ref を更新する
          const link = { url }
          visitor(link)
          node.value = node.value.replace(new RegExp(url, `g`), link.url)
        }
      } catch (err) {
        // 無視する
      }
    }

    // 指定された url 属性を持つ要素をすべて取り出す
    function extractUrlAttributeAndElement(selection, attribute) {
      return (
        selection
          // その属性を持つ要素を取り出す
          .map(function () {
            const element = $(this)
            const url = $(this).attr(attribute)
            if (url && isRelativeUrl(url)) {
              return { url, element }
            }
            return undefined
          })
          // cheerio のオブジェクト -> 配列
          .toArray()
          // 空の値や undefined の値を取り除く
          .filter(Boolean)
      )
    }

    // 画像を処理する
    extractUrlAttributeAndElement($(`img[src]`), `src`).forEach(
      ({ url, element }) => {
        try {
          const ext = url.split(`.`).pop()
          if (!options.ignoreFileExtensions.includes(ext)) {
            generateImagesAndUpdateNode(element, node)
          }
        } catch (err) {
          // 無視する
        }
      }
    )

    // video タグを処理する。
    extractUrlAttributeAndElement(
      $(`video source[src], video[src]`),
      `src`
    ).forEach(processUrl)

    // video の poster を処理する。
    extractUrlAttributeAndElement($(`video[poster]`), `poster`).forEach(
      extractedUrlAttributeAndElement =>
        processUrl({ ...extractedUrlAttributeAndElement, isRequired: true })
    )

    // audio タグを処理する。
    extractUrlAttributeAndElement(
      $(`audio source[src], audio[src]`),
      `src`
    ).forEach(processUrl)

    // flash の embed タグを処理する。
    extractUrlAttributeAndElement($(`object param[value]`), `value`).forEach(
      processUrl
    )

    // a タグを処理する。
    extractUrlAttributeAndElement($(`a[href]`), `href`).forEach(processUrl)

    return
  })

  return Promise.all(
    Array.from(filesToCopy, async ([linkPath, newFilePath]) => {
      // その場所にファイルがすでに存在する場合は、何もコピーしない。
      if (!fsExtra.existsSync(newFilePath)) {
        try {
          await fsExtra.ensureDir(path.dirname(newFilePath))
          await fsExtra.copy(linkPath, newFilePath)
        } catch (err) {
          console.error(`error copying file`, err)
        }
      }
    })
  )
}
