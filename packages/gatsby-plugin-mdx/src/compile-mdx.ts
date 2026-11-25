import deepmerge from "deepmerge"
import type { NodePluginArgs, PluginOptions } from "gatsby"
import type { ProcessorOptions } from "@mdx-js/mdx"
import type { IMdxMetadata } from "./types"
import { enhanceMdxOptions, IMdxPluginOptions } from "./plugin-options"
import { ERROR_CODES } from "./error-utils"
import { cachedImport, createFileToMdxCacheKey } from "./cache-helpers"
import { getProcessorData, setProcessorData } from "./processor-data"

// MDX を JS にコンパイルする
// 元の @mdx-js/loader との違い:
// * MDX ノードとメタデータオブジェクトをプロセッサーに渡す
// * 元の mdx ファイルのパスを、プロセッサーが使う VFile に注入する
export async function compileMDX(
  { absolutePath, source }: { absolutePath: string; source: string | Buffer },
  options: ProcessorOptions,
  cache: NodePluginArgs[`cache`],
  reporter: NodePluginArgs[`reporter`]
): Promise<{ processedMDX: string; metadata: IMdxMetadata } | null> {
  try {
    const { createProcessor } =
      await cachedImport<typeof import("@mdx-js/mdx")>(`@mdx-js/mdx`)
    const { VFile } = await cachedImport<typeof import("vfile")>(`vfile`)

    const processor = createProcessor(options)

    // 必要なカスタムデータをプロセッサーに渡す
    setProcessorData(
      processor,
      `mdxNodeId`,
      await cache.get(createFileToMdxCacheKey(absolutePath))
    )
    setProcessorData(processor, `mdxMetadata`, {})

    const result = await processor.process(
      // remark プラグインのために、元のファイルのパスを注入する。参照: https://github.com/gatsbyjs/gatsby/issues/26914
      new VFile({ value: source, path: absolutePath })
    )

    // 後続の処理で上書きされないよう、メタデータを複製する
    const clonedMetadata = Object.assign(
      {},
      getProcessorData(processor, `mdxMetadata`)
    )
    const processedMDX = result.toString()

    return { processedMDX, metadata: clonedMetadata }
  } catch (error) {
    reporter.panicOnBuild({
      id: ERROR_CODES.MdxCompilation,
      context: {
        absolutePath,
        errorMeta: error,
      },
    })
    return null
  }
}

/**
 * このヘルパー関数を使うと、MDX のコンパイルパイプラインに追加のプラグインや設定を
 * 注入できる。カスタムのメタデータを返す独自のリゾルバーを作るときにとても役立つ。
 * 内部では、目次と抜粋の生成に使っている。
 */
export const compileMDXWithCustomOptions = async (
  { absolutePath, source }: { absolutePath: string; source: string | Buffer },
  {
    pluginOptions,
    customOptions,
    getNode,
    getNodesByType,
    pathPrefix,
    reporter,
    cache,
    store,
  }: {
    pluginOptions: PluginOptions
    customOptions: Partial<IMdxPluginOptions>
    getNode: NodePluginArgs[`getNode`]
    getNodesByType: NodePluginArgs[`getNodesByType`]
    pathPrefix: string
    reporter: NodePluginArgs[`reporter`]
    cache: NodePluginArgs[`cache`]
    store: NodePluginArgs[`store`]
  }
): Promise<{
  processedMDX: string
  metadata: IMdxMetadata
} | null> => {
  const customPluginOptions = deepmerge(
    Object.assign({}, pluginOptions),
    customOptions
  )

  // MDX のコンパイルを準備する
  const mdxOptions = await enhanceMdxOptions(customPluginOptions, {
    getNode,
    getNodesByType,
    pathPrefix,
    reporter,
    cache,
    store,
  })

  // MDX をコンパイルしてメタデータを取り出す
  return compileMDX(
    {
      source: source,
      absolutePath: absolutePath,
    },
    mdxOptions,
    cache,
    reporter
  )
}
