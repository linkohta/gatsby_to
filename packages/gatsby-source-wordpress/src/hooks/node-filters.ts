import { IJSON } from "../utils/fetch-graphql"
import { getStore } from "~/store"

interface INodeFilterInput {
  name: string
  context: IJSON
  data: IJSON
}

type NodeFilterFn = (INodeFilterInput) => IJSON

interface INodeFilter {
  name: string
  filter: NodeFilterFn
  priority: number
}

/**
 * redux ストアからフィルター関数の配列を取得し、
 * 優先度順に並べ替えて、渡されたデータに対して順番に実行する。
 * 変更後のデータを返す
 *
 * @param {string} name 適用するフィルターの名前
 * @param {object} context 適用するフィルター関数に渡す追加のデータ
 * @param {object} data フィルターをかける元のデータ
 */
export const applyNodeFilter = async ({
  name,
  context,
  data,
}: INodeFilterInput): Promise<IJSON> => {
  if (!name) {
    return data
  }

  const nodeFilters: Array<INodeFilter> =
    getStore().getState().wpHooks.nodeFilters?.[name]

  if (!nodeFilters || !nodeFilters.length) {
    return data
  }

  const sortedNodeFilters = nodeFilters.sort((a, b) => a.priority - b.priority)

  for (const { filter } of sortedNodeFilters) {
    data = filter({ data, context, name })
  }

  return data
}

/**
 * この関数は、フィルターを保持する内部の redux ストアにフィルターを追加する
 * 追加したフィルターは、上の applyNodeFilter で適用される
 *
 * @param {string} name フィルターの名前
 * @param {function} filter このフィルターを適用するときに実行する関数
 * @param {integer} priority このフィルターを実行する優先度。小さいほど先に実行される
 */
export const addNodeFilter = ({
  name,
  filter,
  priority,
}: INodeFilter): void => {
  getStore().dispatch.wpHooks.addNodeFilter({ name, filter, priority })
}
