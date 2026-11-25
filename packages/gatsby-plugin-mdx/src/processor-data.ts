import type { IMdxMetadata } from "./types"

// このプラグインが unified のプロセッサーの data に入れる値
interface IMdxProcessorData {
  mdxNodeId?: string
  mdxMetadata?: IMdxMetadata
}

// unified 11 の型は、data のキーを unified の `Data` インターフェースに宣言済みのものに限る。
// `Data` を拡張するには `I` で始まらない名前のインターフェースを宣言する必要があり、このリポジトリの
// 命名規則に合わないので、型を付け直した関数を通して読み書きする。
type UntypedData = (key: string, value?: unknown) => unknown

interface IHasData {
  data: unknown
}

export function setProcessorData<Key extends keyof IMdxProcessorData>(
  processor: IHasData,
  key: Key,
  value: IMdxProcessorData[Key]
): void {
  ;(processor.data as UntypedData).call(processor, key, value)
}

export function getProcessorData<Key extends keyof IMdxProcessorData>(
  processor: IHasData,
  key: Key
): IMdxProcessorData[Key] {
  return (processor.data as UntypedData).call(
    processor,
    key
  ) as IMdxProcessorData[Key]
}
