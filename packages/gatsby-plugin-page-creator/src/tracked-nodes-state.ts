import { extractModel } from "./path-utils"
import type { IOptions } from "./types"

export interface ICreateAPageFromNodeArgs {
  node: Record<string, Record<string, unknown>>
  absolutePath: string
}
export interface IStatePerInstance {
  changedNodesSinceLastPageCreation: {
    deleted: Map<string, { id: string; contentDigest: string }>
    created: Map<string, { id: string; contentDigest: string; type: string }>
  }
  /**
   * nodeType から、そのノードタイプを使っている絶対ファイルパスの一覧への対応
   */
  trackedTypes: Map<string, Set<string>>
  /**
   * ノードの変更をもとに、ページへ変更（作成、更新、削除）を
   * 適用する
   */
  syncPages?: () => void
  /**
   * テンプレートファイルが削除された後、追跡中の状態を片付ける
   */
  templateFileRemoved: (absolutePath: string) => void
  /**
   * 作成したページを、ノード id とテンプレートファイルのパスごとに記録する
   */
  nodeIdToPagePath: Map<string, Map<string, string>>
  /**
   * 既知のページパスの一覧。すでに存在するページを作成しようとするのを避けるためである
   */
  knownPagePaths: Set<string>
  /**
   * テンプレートの絶対パスと、解決済みのノードのフィールドから、ページのパスを組み立てる
   */
  getPathFromAResolvedNode?: (arg: ICreateAPageFromNodeArgs) => Promise<string>
  /**
   * ノードとテンプレートの絶対パスからページを作成する
   */
  createAPageFromNode?: (
    arg: ICreateAPageFromNodeArgs
  ) => Promise<{ errors: number; path: string } | undefined>
  /**
   * あるノード id から作成されたページをすべて削除する
   */
  deletePagesCreateFromNode?: (id: string) => void
  /**
   * graphql クエリを実行して、指定されたノード id のフィールドを解決する
   */
  resolveFields?: (
    nodeIds: Array<string>,
    absolutePath: string
  ) => Promise<Array<Record<string, Record<string, unknown>>>>
}

const pluginInstances = new Map<string, IStatePerInstance>()

export function getPluginInstance(
  pluginOptions: Pick<IOptions, "path">
): IStatePerInstance {
  let pluginInstance = pluginInstances.get(pluginOptions.path)
  if (!pluginInstance) {
    pluginInstance = {
      changedNodesSinceLastPageCreation: {
        created: new Map(),
        deleted: new Map(),
      },
      trackedTypes: new Map(),
      nodeIdToPagePath: new Map(),
      knownPagePaths: new Set(),
      templateFileRemoved(absolutePath: string): void {
        const nodeType = extractModel(absolutePath)
        if (nodeType) {
          const absolutePaths = this.trackedTypes.get(nodeType)
          if (absolutePaths) {
            absolutePaths.delete(absolutePath)
            if (absolutePaths.size === 0) {
              this.trackedTypes.delete(nodeType)
            }
          }
        }

        for (const [
          nodeId,
          templatesToPagePaths,
        ] of this.nodeIdToPagePath.entries()) {
          const pagePaths = templatesToPagePaths.get(absolutePath)
          if (pagePaths) {
            for (const pagePath of pagePaths) {
              this.knownPagePaths.delete(pagePath)
            }
            templatesToPagePaths.delete(absolutePath)
            if (templatesToPagePaths.size === 0) {
              this.nodeIdToPagePath.delete(nodeId)
            }
          }
        }
      },
    }

    pluginInstances.set(pluginOptions.path, pluginInstance)
  }

  return pluginInstance
}
