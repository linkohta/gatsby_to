import { IGatsbyNode } from "../redux/types"
import { getDataStore } from "./datastore"

export { getDataStore } from "./datastore"

// 便利なアクセサーメソッド

/**
 * データストアからすべてのノードを取得する。
 * @deprecated
 */
export const getNodes = (): Array<IGatsbyNode> => getDataStore().getNodes()

/**
 * データストアから id でノードを取得する。
 */
export const getNode = (id: string): IGatsbyNode | undefined =>
  getDataStore().getNode(id)

/**
 * データストアから、指定した型のすべてのノードを取得する。
 * @deprecated
 */
export const getNodesByType = (type: string): Array<IGatsbyNode> =>
  getDataStore().getNodesByType(type)

/**
 * データストアからすべての型名を取得する。
 */
export const getTypes = (): Array<string> => getDataStore().getTypes()
