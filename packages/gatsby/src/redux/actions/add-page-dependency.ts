import { store } from "../"
import Batcher from "../../utils/batcher"
import {
  createPageDependency as internalCreatePageDependency,
  createPageDependencies as internalCreatePageDependencies,
} from "./internal"

export const createPageDependencyBatcher = new Batcher<
  typeof internalCreatePageDependency
>(1000)

createPageDependencyBatcher.bulkCall(createCalls => {
  const dependencyPayloads = createCalls.map(call => call[0])
  store.dispatch(internalCreatePageDependencies(dependencyPayloads))
})

export const createPageDependency = ({
  path,
  nodeId,
  connection,
}: {
  path: string
  nodeId: string
  connection?: string
}): void => {
  const { queries } = store.getState()

  // やかましいアクションを大量に作らずに済むように、依存がまだ記録されて
  // いないことを確認する。
  let nodeDependencyExists = false
  let connectionDependencyExists = false
  if (!nodeId) {
    nodeDependencyExists = true
  }
  if (
    nodeId &&
    queries.byNode.has(nodeId) &&
    queries.byNode.get(nodeId)!.has(path)
  ) {
    nodeDependencyExists = true
  }
  if (!connection) {
    connectionDependencyExists = true
  }
  if (
    connection &&
    queries.byConnection.has(connection) &&
    queries.byConnection.get(connection)!.has(path)
  ) {
    connectionDependencyExists = true
  }
  if (nodeDependencyExists && connectionDependencyExists) {
    return
  }

  // 新しいものなので dispatch する
  createPageDependencyBatcher.add({ path, nodeId, connection })
}
