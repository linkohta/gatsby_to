import chokidar, { FSWatcher } from "chokidar"
import { Actions, ParentSpanPluginArgs, GatsbyCache, Reporter } from "gatsby"
import { createImageNode, IImageMetadata, writeImage } from "./image-processing"
import type { FileSystemNode } from "gatsby-source-filesystem"

let watcher: FSWatcher | undefined

/**
 * develop 中に、静的な元画像の変更を監視する
 */
export function watchImage({
  fullPath,
  pathPrefix,
  createNodeId,
  createNode,
  cache,
  reporter,
}: {
  fullPath: string
  pathPrefix: string
  createNodeId: ParentSpanPluginArgs["createNodeId"]
  createNode: Actions["createNode"]
  cache: GatsbyCache
  reporter: Reporter
}): void {
  // 共有の watcher を使うが、必要になったときにだけ作成する
  if (!watcher) {
    watcher = chokidar.watch(fullPath)
    watcher.on(`change`, async (path: string): Promise<void> => {
      reporter.verbose(`Image changed: ${path}`)
      const node = await createImageNode({
        fullPath: path,
        createNodeId,
        createNode,
        reporter,
      })
      if (!node) {
        reporter.warn(`Could not process image ${path}`)
        return
      }
      await updateImages({ node, cache, pathPrefix, reporter })
    })
  } else {
    // watcher がすでにあれば、この画像を追加するだけでよい
    watcher.add(fullPath)
  }
}
/**
 * ある元画像を使っている静的画像のインスタンスをすべて更新する
 */
async function updateImages({
  cache,
  node,
  pathPrefix,
  reporter,
}: {
  cache: GatsbyCache
  node: FileSystemNode
  pathPrefix: string
  reporter: Reporter
}): Promise<void> {
  // この元画像ファイルを使っている静的画像のインスタンスがあるかを調べる
  const imageRefs: Record<string, IImageMetadata> = await cache.get(
    `ref-${node.id}`
  )

  if (!imageRefs) {
    return
  }

  await Promise.all(
    Object.values(imageRefs).map(
      async ({ contentDigest, args, cacheFilename }) => {
        if (contentDigest && contentDigest === node.internal.contentDigest) {
          // ファイルが変更されていないので、スキップする
          return
        }
        // 画像を更新する
        await writeImage(node, args, pathPrefix, reporter, cache, cacheFilename)
      }
    )
  )
}
