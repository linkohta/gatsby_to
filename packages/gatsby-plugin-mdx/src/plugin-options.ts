import type { ProcessorOptions } from "@mdx-js/mdx"
import type { GatsbyCache, NodePluginArgs, PluginOptions, Store } from "gatsby"
import deepmerge from "deepmerge"
import type { IPluginInfo } from "gatsby-plugin-utils/types"
import { cachedImport } from "./cache-helpers"
import { getSourcePluginsAsRemarkPlugins } from "./get-source-plugins-as-remark-plugins"
import rehypeMdxMetadataExtractor from "./rehype-metadata-extractor"
import { remarkMdxHtmlPlugin } from "./remark-mdx-html-plugin"
import { remarkPathPlugin } from "./remark-path-prefix-plugin"

export interface IMdxPluginOptions {
  extensions: [string]
  mdxOptions: ProcessorOptions
  gatsbyRemarkPlugins?: [IPluginInfo]
}
interface IHelpers {
  getNode: NodePluginArgs[`getNode`]
  getNodesByType: NodePluginArgs[`getNodesByType`]
  pathPrefix: NodePluginArgs[`pathPrefix`]
  reporter: NodePluginArgs[`reporter`]
  cache: GatsbyCache
  store: Store
}
type MdxDefaultOptions = (pluginOptions: PluginOptions) => IMdxPluginOptions

export const defaultOptions: MdxDefaultOptions = pluginOptions => {
  const mdxOptions: ProcessorOptions = {
    format: `mdx`,
    useDynamicImport: true,
    providerImportSource: `@mdx-js/react`,
  }
  const defaults = {
    extensions: [`.mdx`],
    mdxOptions,
  }
  const options = deepmerge(
    defaults,
    pluginOptions
  ) as unknown as IMdxPluginOptions

  return options
}

type EnhanceMdxOptions = (
  pluginOptions: PluginOptions,
  helpers: IHelpers
) => Promise<ProcessorOptions>

export const enhanceMdxOptions: EnhanceMdxOptions = async (
  pluginOptions,
  helpers
) => {
  const options = defaultOptions(pluginOptions)

  const { default: remarkUnwrapImages } =
    await cachedImport<typeof import("remark-unwrap-images")>(
      `remark-unwrap-images`
    )

  // Gatsby プロジェクトの設定をもとに jsxRuntime と jsxImportSource を設定する
  const { config } = helpers.store.getState()
  const { jsxRuntime, jsxImportSource } = config
  options.mdxOptions.jsxRuntime = jsxRuntime || `classic`
  options.mdxOptions.jsxImportSource = jsxImportSource || `react`

  if (!options.mdxOptions.remarkPlugins) {
    options.mdxOptions.remarkPlugins = []
  }

  // アンラップは、他の remark プラグイン（特に gatsby-remark-images）が実行される前に行う必要がある
  // そうしないと、remark-unwrap-images が変換済みの画像を処理してしまう
  options.mdxOptions.remarkPlugins.push(remarkUnwrapImages)

  // 必要に応じて Gatsby のパスプレフィックスを注入する
  if (helpers.pathPrefix) {
    options.mdxOptions.remarkPlugins.push([
      remarkPathPlugin,
      { pathPrefix: helpers.pathPrefix },
    ])
  }

  // gatsby-remark-* プラグインに対応する
  if (
    options.gatsbyRemarkPlugins &&
    Object.keys(options.gatsbyRemarkPlugins).length
  ) {
    if (!options.mdxOptions.remarkPlugins) {
      options.mdxOptions.remarkPlugins = []
    }

    // パーサープラグイン
    for (const plugin of options.gatsbyRemarkPlugins) {
      const requiredPlugin = plugin.module

      if (typeof requiredPlugin.setParserPlugins === `function`) {
        for (const parserPlugin of requiredPlugin.setParserPlugins(
          plugin.pluginOptions || {}
        )) {
          if (Array.isArray(parserPlugin)) {
            const [parser, parserPluginOptions] = parserPlugin
            options.mdxOptions.remarkPlugins.push([parser, parserPluginOptions])
          } else {
            options.mdxOptions.remarkPlugins.push(parserPlugin)
          }
        }
      }
    }

    // トランスフォーマープラグイン
    const gatsbyRemarkPlugins = await getSourcePluginsAsRemarkPlugins({
      gatsbyRemarkPlugins: options.gatsbyRemarkPlugins,
      ...helpers,
    })
    if (gatsbyRemarkPlugins) {
      options.mdxOptions.remarkPlugins.push(...gatsbyRemarkPlugins)
    }
  }

  options.mdxOptions.remarkPlugins.push(remarkMdxHtmlPlugin)

  if (!options.mdxOptions.rehypePlugins) {
    options.mdxOptions.rehypePlugins = []
  }

  const passThrough = [`element`]
  if (!options.mdxOptions.remarkRehypeOptions) {
    options.mdxOptions.remarkRehypeOptions = {}
  }
  options.mdxOptions.remarkRehypeOptions.passThrough = passThrough

  // rehype-infer-* などのプラグインが生成したメタデータを取り出す
  options.mdxOptions.rehypePlugins.push(rehypeMdxMetadataExtractor)

  return options.mdxOptions
}
