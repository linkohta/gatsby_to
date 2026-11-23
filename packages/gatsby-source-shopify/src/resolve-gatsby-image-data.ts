import { readFileSync } from "fs"
import { GatsbyCache } from "gatsby"
import { IGatsbyImageFieldArgs } from "gatsby-plugin-image/graphql-utils"
import { fetchRemoteFile } from "gatsby-core-utils/fetch-remote-file"
import {
  generateImageData,
  getLowResolutionImageURL,
  IGatsbyImageData,
  IGatsbyImageHelperArgs,
  IImage,
  ImageFormat,
} from "gatsby-plugin-image"

import { urlBuilder } from "./get-shopify-image"
import { parseImageExtension } from "./helpers"

type IImageWithPlaceholder = IImage & {
  placeholder: string
}

async function getImageBase64({
  imageAddress,
  directory,
  imageId,
}: {
  imageAddress: string
  directory: string
  imageId: string
}): Promise<string> {
  // ファイルをサイトのキャッシュへダウンロードし、指定した画像のファイルパスを返す（URL ではなく、ホストシステム上のパスである）
  const filePath = await fetchRemoteFile({
    url: imageAddress,
    directory,
    cacheKey: imageId,
  })
  const buffer = readFileSync(filePath)
  return buffer.toString(`base64`)
}

/**
 * 低解像度のプレースホルダーをダウンロードして生成する
 *
 * @param lowResImageFile
 */
function getBase64DataURI({ imageBase64 }: { imageBase64: string }): string {
  return `data:image/png;base64,${imageBase64}`
}

export function makeResolveGatsbyImageData(cache: GatsbyCache) {
  return async function resolveGatsbyImageData(
    image: IShopifyImage,
    {
      formats = [`auto`],
      layout = `constrained`,
      ...remainingOptions
    }: IGatsbyImageFieldArgs
  ): Promise<IGatsbyImageData | null> {
    // Sharp は GIF を最適化できないので、その場合は null を返さなければならない
    const ext = parseImageExtension(image.originalSrc)
    if (ext === `gif`) return null

    let placeholderURL

    const generateImageSource: IGatsbyImageHelperArgs[`generateImageSource`] = (
      filename,
      width,
      height,
      toFormat
    ): IImageWithPlaceholder => {
      return {
        width,
        height,
        placeholder: ``,
        format: toFormat,
        src: urlBuilder({
          width,
          height,
          baseUrl: filename,
          format: toFormat,
          options: {},
        }),
      }
    }

    const sourceMetadata = {
      width: image.width,
      height: image.height,
      format: ext as ImageFormat,
    }

    if (remainingOptions && remainingOptions.placeholder === `blurred`) {
      // この関数は、ぼかしたプレースホルダーとして使う、幅 20px の画像の URL を返す
      const lowResImageURL = getLowResolutionImageURL({
        ...remainingOptions,
        formats,
        layout,
        sourceMetadata,
        pluginName: `gatsby-source-shopify`,
        filename: image.originalSrc,
        generateImageSource,
      })

      const imageBase64 = await getImageBase64({
        imageAddress: lowResImageURL,
        directory: cache.directory as string,
        imageId: image.id,
      })

      placeholderURL = getBase64DataURI({ imageBase64 })
    }
    return generateImageData({
      ...remainingOptions,
      placeholderURL,
      formats,
      layout,
      sourceMetadata,
      pluginName: `gatsby-source-shopify`,
      filename: image.originalSrc,
      generateImageSource,
    })
  }
}
