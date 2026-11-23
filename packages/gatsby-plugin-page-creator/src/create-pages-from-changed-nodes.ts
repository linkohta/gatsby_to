import type { CreatePagesArgs } from "gatsby"
import { getPluginInstance, IStatePerInstance } from "./tracked-nodes-state"
import type { IOptions } from "./types"

export async function createPagesFromChangedNodes(
  {
    actions,
  }: Pick<CreatePagesArgs, `actions`> & {
    pluginInstance: IStatePerInstance
  },
  pluginOptions: IOptions
): Promise<void> {
  // 削除または作成されたノードをループして、ノードを削除し、まだ見ていない
  // ノードを作成してから、配列をリセットする。
  const pluginInstance = getPluginInstance(pluginOptions)

  if (pluginInstance.trackedTypes.size === 0) {
    return
  }

  if (!pluginInstance.createAPageFromNode) {
    throw new Error(`Expected pluginInstance.createAPageFromNode to be defined`)
  }

  if (!pluginInstance.deletePagesCreateFromNode) {
    throw new Error(
      `Expected pluginInstance.deletePagesCreateFromNode to be defined`
    )
  }

  if (!pluginInstance.resolveFields) {
    throw new Error(`Expected pluginInstance.resolveFields to be defined`)
  }

  if (!pluginInstance.getPathFromAResolvedNode) {
    throw new Error(
      `Expected pluginInstance.getPathFromAResolvedNode to be defined`
    )
  }

  for (const {
    id,
  } of pluginInstance.changedNodesSinceLastPageCreation.deleted.values()) {
    pluginInstance.deletePagesCreateFromNode(id)
  }

  const nodesToResolve = new Map<string, Set<string>>()

  for (const {
    id,
    type,
  } of pluginInstance.changedNodesSinceLastPageCreation.created.values()) {
    if (pluginInstance.trackedTypes.has(type)) {
      const absolutePaths = pluginInstance.trackedTypes.get(type)
      if (absolutePaths) {
        for (const absolutePath of absolutePaths) {
          let nodeIdsForTemplate = nodesToResolve.get(absolutePath)
          if (!nodeIdsForTemplate) {
            nodeIdsForTemplate = new Set<string>()
            nodesToResolve.set(absolutePath, nodeIdsForTemplate)
          }
          nodeIdsForTemplate.add(id)
        }
      }
    }
  }

  for (const [absolutePath, nodeIds] of nodesToResolve.entries()) {
    const resolvedNodes = await pluginInstance.resolveFields(
      Array.from(nodeIds),
      absolutePath
    )

    for (const node of resolvedNodes) {
      const path = await pluginInstance.getPathFromAResolvedNode({
        node,
        absolutePath,
      })
      const previousPath = pluginInstance.nodeIdToPagePath
        .get(node.id as any)
        ?.get(absolutePath)

      if (previousPath !== path) {
        if (previousPath) {
          actions.deletePage({
            path: previousPath,
            component: absolutePath,
          })
          pluginInstance.nodeIdToPagePath
            .get(node.id as any)
            ?.delete(absolutePath)
          pluginInstance.knownPagePaths.delete(previousPath)
        }

        pluginInstance.createAPageFromNode({
          node,
          absolutePath,
        })
      }
    }
  }

  // 変更されたノードを消去する
  pluginInstance.changedNodesSinceLastPageCreation = {
    created: new Map(),
    deleted: new Map(),
  }
}
