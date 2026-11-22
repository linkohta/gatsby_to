import type { Plugin } from "unified"

/**
 * このプラグインは、ファイルからメタデータを取り出し、
 * 後で取り出せるよう unified のプロセッサーのデータに保存する。
 */
const rehypeMdxMetadataExtractor: Plugin = function () {
  const metadata = {}
  // eslint-disable-next-line @babel/no-invalid-this
  this.data(`mdxMetadata`, metadata)
  return (_tree, file): void => {
    Object.assign(metadata, file.data.meta)
  }
}

export default rehypeMdxMetadataExtractor
