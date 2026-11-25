import type { VFile, Data as VFileData } from "vfile"
import type { Node } from "gatsby"

export interface IMdxNode extends Node {
  rawBody?: string
  body?: string
}

export interface IFileNode extends Node {
  sourceInstanceName?: string
  absolutePath?: string
}

interface IMdxVFileDataMeta {
  [key: string]: unknown
}

interface IMdxVFileData extends Omit<VFileData, `meta`> {
  meta?: IMdxVFileDataMeta
}

export interface IMdxVFile extends Omit<VFile, `data`> {
  data: IMdxVFileData
}

export interface IMdxMetadata {
  [key: string]: unknown
}
