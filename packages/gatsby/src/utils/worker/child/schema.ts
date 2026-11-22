import * as path from "path"
import * as fs from "fs-extra"

import { store } from "../../../redux"
import { actions } from "../../../redux/actions"
import { build } from "../../../schema"
import apiRunnerNode from "../../api-runner-node"
import { setState } from "./state"

export function setInferenceMetadata(): void {
  setState([`inferenceMetadata`])
}

export async function buildSchema(): Promise<void> {
  const workerStore = store.getState()

  // pathPrefix: '' は、少なくとも設定の読み込み時には定義されている
  if ((workerStore?.config?.pathPrefix ?? null) === null) {
    throw Error(
      `Config loading didn't finish before attempting to build schema in worker`
    )
  }

  const schemaSnapshotPath = path.join(
    workerStore.program.directory,
    `.cache`,
    `schema.gql`
  )

  if (await fs.pathExists(schemaSnapshotPath)) {
    const schemaSnapshot = await fs.readFile(schemaSnapshotPath, `utf-8`)
    store.dispatch(actions.createTypes(schemaSnapshot))
  }

  setInferenceMetadata()

  await apiRunnerNode(`createSchemaCustomization`)

  // build() は "createResolvers" や "setFieldsOnGraphQLNodeType" といったほかのライフサイクルを内部で実行する
  await build({ fullMetadataBuild: false, parentSpan: {} })
}
