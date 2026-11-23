import { debounce, cloneDeep } from "lodash"
import { emitter, store } from "../redux"
import { rebuild } from "../schema"
import { haveEqualFields } from "../schema/infer/inference-metadata"
import { updateStateAndRunQueries } from "../query/query-watcher"
import report from "gatsby-cli/lib/reporter"
import { IGatsbyState } from "../redux/types"

type TypeMap = IGatsbyState[`inferenceMetadata`][`typeMap`]
type InferenceMetadata = IGatsbyState[`inferenceMetadata`]

const inferredTypesChanged = (
  typeMap: TypeMap,
  prevTypeMap: TypeMap
): boolean =>
  Object.keys(typeMap).some(
    type =>
      typeMap[type].dirty && !haveEqualFields(typeMap[type], prevTypeMap[type])
  )

let lastMetadata: InferenceMetadata

// API_RUNNING_QUEUE_EMPTY は短時間に何度も emit されることがあるので、
// debounce するのが妥当と思われる
const maybeRebuildSchema = debounce(async (): Promise<void> => {
  const { inferenceMetadata } = store.getState()

  if (!inferredTypesChanged(inferenceMetadata.typeMap, lastMetadata.typeMap)) {
    return
  }

  const activity = report.activityTimer(`rebuild schema`)
  activity.start()
  await rebuild({ parentSpan: activity })
  await updateStateAndRunQueries(false, { parentSpan: activity.span })
  activity.end()
}, 1000)

function snapshotInferenceMetadata(): void {
  const { inferenceMetadata } = store.getState()
  lastMetadata = cloneDeep(inferenceMetadata)
}

export function bootstrapSchemaHotReloader(): void {
  // 最後にスキーマを再構築した時点の推論メタデータのスナップショットを取る
  // （スキーマが別の場所で再構築された場合も含む）
  // 後でこのスナップショットを使い、最後の再構築以降に推論された型が実際に変わったかを確認する
  snapshotInferenceMetadata()
  emitter.on(`SET_SCHEMA`, snapshotInferenceMetadata)

  startSchemaHotReloader()
}

export function startSchemaHotReloader(): void {
  // 通常の sourceNodes API の呼び出し以外で起きるノードの変更を待ち受ける。
  // たとえば、ウォッチャーによる markdown ファイルの更新など
  emitter.on(`API_RUNNING_QUEUE_EMPTY`, maybeRebuildSchema)
}

export function stopSchemaHotReloader(): void {
  emitter.off(`API_RUNNING_QUEUE_EMPTY`, maybeRebuildSchema)
  maybeRebuildSchema.cancel()
}
