import { createNodeId } from "../../../utils/create-node-id"
import { IPluginRefObject } from "../types"

/**
 * キーがプラグインのオプションに対して一意になるようにする。たとえば、
 * 名前の異なる（docs、blogs）複数の source-filesystem プラグインが
 * 存在することがある。
 *
 * @param name プラグインの名前
 * @param pluginObject プラグインのオブジェクト
 */
export const createPluginId = (
  name: string,
  pluginObject: IPluginRefObject | null = null
): string =>
  createNodeId(
    name + (pluginObject ? JSON.stringify(pluginObject.options) : ``),
    `Plugin`
  )
