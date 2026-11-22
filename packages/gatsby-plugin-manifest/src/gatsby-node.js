import * as fs from "fs"
import * as path from "path"
// TODO(v5): gatsby/sharp を使う
import getSharpInstance from "./safe-sharp"
import { createContentDigest, slash } from "gatsby-core-utils"
import { defaultIcons, addDigestToPath, favicons } from "./common"
import { doesIconExist } from "./node-helpers"

import pluginOptionsSchema from "./pluginOptionsSchema"

async function generateIcon(icon, srcIcon) {
  const imgPath = path.join(`public`, icon.src)

  // console.log(`generating icon: `, icon.src)
  // if (fs.existsSync(imgPath)) {
  //   console.log(`icon already Exists, not regenerating`)
  //   return true
  // }
  const size = parseInt(icon.sizes.substring(0, icon.sizes.lastIndexOf(`x`)))

  // ベクター画像の場合は、ラスタライズ先の解像度に合ったピクセル密度を
  // 使うよう sharp に指示する。
  // ピクセル画像が元の場合は何も影響しない。
  // sharp は 1 から 2400 までの密度を受け付ける
  const density = Math.min(2400, Math.max(1, size))

  const sharp = await getSharpInstance()
  return sharp(srcIcon, { density })
    .resize({
      width: size,
      height: size,
      fit: `contain`,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .toFile(imgPath)
}

async function checkCache(cache, icon, srcIcon, srcIconDigest, callback) {
  const cacheKey = createContentDigest(`${icon.src}${srcIcon}${srcIconDigest}`)

  const created = cache.get(cacheKey, srcIcon)
  if (!created) {
    cache.set(cacheKey, true)

    try {
      await callback(icon, srcIcon)
    } catch (e) {
      cache.set(cacheKey, false)
      throw e
    }
  }
}

exports.pluginOptionsSchema = pluginOptionsSchema

/**
 * pluginOption のデフォルト値を設定する
 * TODO: pluginOptionsSchema が安定したら削除する
 */
exports.onPreInit = (_, pluginOptions) => {
  pluginOptions.cache_busting_mode = pluginOptions.cache_busting_mode ?? `query`
  pluginOptions.include_favicon = pluginOptions.include_favicon ?? true
  pluginOptions.legacy = pluginOptions.legacy ?? true
  pluginOptions.theme_color_in_head = pluginOptions.theme_color_in_head ?? true
  pluginOptions.cacheDigest = null

  if (pluginOptions.cache_busting_mode !== `none` && pluginOptions.icon) {
    pluginOptions.cacheDigest = createContentDigest(
      fs.readFileSync(pluginOptions.icon)
    )
  }
}

exports.onPostBootstrap = async (
  { reporter, parentSpan, basePath },
  { localize, ...manifest }
) => {
  const activity = reporter.activityTimer(`Build manifest and related icons`, {
    parentSpan,
  })

  activity.start()

  const cache = new Map()

  await makeManifest({ cache, reporter, pluginOptions: manifest, basePath })

  if (Array.isArray(localize)) {
    const locales = [...localize]
    await Promise.all(
      locales.map(locale => {
        let cacheModeOverride = {}

        /* src の Icon が異なる場合、ローカライズでは出力ファイルの名前を一意にする必要がある。
           そうしないと、自動モードで、ある言語のアイコンが別の言語のアイコンで上書きされてしまう。
        */
        if (locale.hasOwnProperty(`icon`) && !locale.hasOwnProperty(`icons`)) {
          // console.debug(`OVERRIDING CACHE BUSTING`, locale)
          cacheModeOverride = { cache_busting_mode: `name` }
        }

        return makeManifest({
          cache,
          reporter,
          pluginOptions: {
            ...manifest,
            ...locale,
            ...cacheModeOverride,
          },
          shouldLocalize: true,
          basePath,
        })
      })
    )
  }
  activity.end()
}

/**
 * 完全なトライフォース、またはトライフォースの 1 つ以上の構成要素。
 * @typedef {Object} makeManifestArgs
 * @property {Object} cache - gatsby-node api から渡される
 * @property {Object} reporter - gatsby-node api から渡される
 * @property {Object} pluginOptions - gatsby-node api と gatsby config から渡される
 * @property {boolean?} shouldLocalize
 * @property {string?} basePath - gatsby node から渡される base path の文字列
 */

/**
 * manifest をビルドする
 * @param {makeManifestArgs}
 */
const makeManifest = async ({
  cache,
  reporter,
  pluginOptions,
  shouldLocalize = false,
  basePath = ``,
}) => {
  const { icon, ...manifest } = pluginOptions
  const suffix =
    shouldLocalize && pluginOptions.lang ? `_${pluginOptions.lang}` : ``

  const faviconIsEnabled = pluginOptions.include_favicon ?? true

  // manifest.webmanifest に渡さないオプションを削除する。
  delete manifest.plugins
  delete manifest.legacy
  delete manifest.theme_color_in_head
  delete manifest.cache_busting_mode
  delete manifest.crossOrigin
  delete manifest.icon_options
  delete manifest.include_favicon
  delete manifest.cacheDigest

  // アイコンが手動で定義されていなければ、デフォルトのアイコン一式を使う。
  if (!manifest.icons) {
    manifest.icons = [...defaultIcons]
  }

  // （指定があれば）各アイコンに追加のオプションを設定する。
  if (pluginOptions.icon_options) {
    manifest.icons = manifest.icons.map(icon => {
      return {
        ...pluginOptions.icon_options,
        ...icon,
      }
    })
  }

  // アイコンの出力先のパスを決める。
  const paths = {}
  manifest.icons.forEach(icon => {
    const iconPath = path.join(`public`, path.dirname(icon.src))
    if (!paths[iconPath]) {
      const exists = fs.existsSync(iconPath)
      // 出力先のディレクトリがなければ作成する
      if (!exists) {
        fs.mkdirSync(iconPath, { recursive: true })
      }
      paths[iconPath] = true
    }
  })

  // src のアイコンが定義されている場合にだけ、アイコンを自動生成する。
  if (typeof icon !== `undefined`) {
    // アイコンが存在するかを確認する
    if (!doesIconExist(icon)) {
      throw new Error(
        `icon (${icon}) does not exist as defined in gatsby-config.js. Make sure the file exists relative to the root of the site.`
      )
    }

    const sharp = await getSharpInstance()
    const sharpIcon = sharp(icon)

    const metadata = await sharpIcon.metadata()

    if (metadata.width !== metadata.height) {
      reporter.warn(
        `The icon(${icon}) you provided to 'gatsby-plugin-manifest' is not square.\n` +
          `The icons we generate will be square and for the best results we recommend you provide a square icon.\n`
      )
    }

    // キャッシュバスティングを追加する
    const cacheMode =
      typeof pluginOptions.cache_busting_mode !== `undefined`
        ? pluginOptions.cache_busting_mode
        : `query`

    const iconDigest = createContentDigest(fs.readFileSync(icon))

    /**
     * アイコンの設定の配列を受け取り、元のアイコン画像から
     * 各サイズの出力を生成する。
     */
    async function processIconSet(iconSet) {
      // キャッシュバスティングを URL のクエリで行う場合は、キャッシュバスティングの前にアイコンを生成する必要がある
      if (cacheMode === `query`) {
        for (const dstIcon of iconSet) {
          await checkCache(cache, dstIcon, icon, iconDigest, generateIcon)
        }
      }

      if (cacheMode !== `none`) {
        iconSet = iconSet.map(icon => {
          const newIcon = { ...icon }
          newIcon.src = addDigestToPath(icon.src, iconDigest, cacheMode)
          return newIcon
        })
      }

      // キャッシュバスティングでファイル名を変更する場合は、キャッシュバスティングの後にアイコンを生成する必要がある
      if (cacheMode !== `query`) {
        for (const dstIcon of iconSet) {
          await checkCache(cache, dstIcon, icon, iconDigest, generateIcon)
        }
      }

      return iconSet
    }

    manifest.icons = await processIconSet(manifest.icons)

    // favicon が有効な場合は、同じキャッシュポリシーを適用して、
    // リサイズした画像を生成する
    if (faviconIsEnabled) {
      await processIconSet(favicons)

      if (metadata.format === `svg`) {
        fs.copyFileSync(icon, path.join(`public`, `favicon.svg`))
      }
    }
  }

  // パスにプレフィックスを付けて #18497 を修正する
  manifest.icons = manifest.icons.map(icon => {
    return {
      ...icon,
      src: slash(path.join(basePath, icon.src)),
    }
  })

  if (manifest.start_url) {
    manifest.start_url = path.posix.join(basePath, manifest.start_url)
  }

  // manifest を書き出す
  fs.writeFileSync(
    path.join(`public`, `manifest${suffix}.webmanifest`),
    JSON.stringify(manifest)
  )
}

exports.onCreateWebpackConfig = ({ actions, plugins }, pluginOptions) => {
  actions.setWebpackConfig({
    plugins: [
      plugins.define({
        __MANIFEST_PLUGIN_HAS_LOCALISATION__:
          pluginOptions.localize && pluginOptions.localize.length,
      }),
    ],
  })
}
