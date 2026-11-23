import { inspect } from "util"
import { store } from "../../../redux"
import { IGatsbyNode } from "../../../redux/types"
import { IDataStore, ILmdbDatabases } from "../../types"
import { cartesianProduct, resolveFieldValue } from "./common"

interface IIndexingContext {
  databases: ILmdbDatabases
  datastore: IDataStore
}

export type IndexFields = Map<string, number> // 名前、方向

export interface IIndexMetadata {
  state: `ready` | `building` | `stale` | `error` | `initial`
  error?: string
  typeName: string
  keyPrefix: number | string
  keyFields: Array<[fieldName: string, orderDirection: number]>
  multiKeyFields: Array<string>

  // マルチキーインデックスの統計情報
  // （たとえばノードが { id: `id`, foo: [1,2] } の場合、[1,`id`] と [2,`id`] の 2 つのインデックスキーになる）
  stats: {
    keyCount: number
    itemCount: number
    maxKeysPerItem: number
  }
}

export const undefinedSymbol = Symbol.for(`undef`)

export type IndexFieldValue =
  | number
  | string
  | boolean
  | null
  | typeof undefinedSymbol
  | Array<IndexFieldValue>

export type IndexKey = Array<IndexFieldValue>

export async function createIndex(
  context: IIndexingContext,
  typeName: string,
  indexFields: IndexFields
): Promise<IIndexMetadata> {
  const indexName = buildIndexName(typeName, indexFields)
  const meta = getIndexMetadata(context, typeName, indexFields, false)

  switch (meta?.state) {
    case `ready`:
      return meta
    case `building`: {
      return indexReady(context, indexName)
    }
    case `initial`:
    default: {
      try {
        await lockIndex(context, indexName)
      } catch (err) {
        // インデックスが他のプロセスで更新中である。
        // 待機し、完了したら正常な状態になっていると仮定する
        return indexReady(context, indexName)
      }
      return doCreateIndex(context, typeName, indexFields)
    }
  }
}

export function getIndexMetadata(
  context: IIndexingContext,
  typeName: string,
  indexFields: IndexFields,
  assertReady = true
): IIndexMetadata {
  const { databases } = context
  const indexName = buildIndexName(typeName, indexFields)
  const meta: IIndexMetadata = databases.metadata.get(toMetadataKey(indexName))

  if (assertReady && meta?.state !== `ready`) {
    throw new Error(
      `Index ${indexName} is not ready yet. State: ${meta?.state ?? `unknown`}`
    )
  }
  return meta
}

async function doCreateIndex(
  context: IIndexingContext,
  typeName: string,
  indexFields: IndexFields
): Promise<IIndexMetadata> {
  const { datastore, databases } = context
  const { indexes, metadata } = databases
  const indexName = buildIndexName(typeName, indexFields)

  const label = `Indexing ${indexName}`
  console.time(label)

  // インデックスの作成前にマテリアライズが実行されていると仮定する
  const resolvedNodes = store.getState().resolvedNodesCache.get(typeName)

  // TODO: dirty なノードだけを走査する
  // TODO: 非同期トランザクションで包むか
  const stats: IIndexMetadata[`stats`] = {
    maxKeysPerItem: 0,
    keyCount: 0,
    itemCount: 0,
  }
  const indexMetadata: IIndexMetadata = {
    state: `building`,
    typeName,
    keyFields: [...indexFields],
    multiKeyFields: [],
    keyPrefix: indexName, // FIXME
    stats,
  }

  try {
    let i = 0
    for (const node of datastore.iterateNodesByType(typeName)) {
      // マテリアライズ（`filter` 句と `sort` 句のフィールドに対するカスタムリゾルバーの実行）が実行済みであると仮定する
      //  また、それらのフィールドのマテリアライズされた値が resolvedNodes に保存されていると仮定する
      const resolvedFields = resolvedNodes?.get(node.id)
      const { keys, multiKeyFields } = prepareIndexKeys(
        node,
        resolvedFields,
        indexName,
        indexFields
      )
      stats.keyCount += keys.length
      stats.itemCount++
      stats.maxKeysPerItem = Math.max(stats.maxKeysPerItem, keys.length)
      indexMetadata.multiKeyFields.push(...multiKeyFields)

      for (const indexKey of keys) {
        // 注: indexKey が 1978 文字（lmdb の上限）を超える場合や、オブジェクトや Buffer などを含む場合は、例外を投げることがある
        indexes.put(indexKey, node.id)
      }
      if (++i % 5000 === 0) {
        // イベントループを長くブロックしすぎないようにする
        await new Promise(resolve => setTimeout(resolve, 3))
      }
    }
    indexMetadata.state = `ready`
    indexMetadata.multiKeyFields = [...new Set(indexMetadata.multiKeyFields)]

    await metadata.put(toMetadataKey(indexName), indexMetadata)
    console.timeEnd(label)

    return indexMetadata
  } catch (e) {
    indexMetadata.state = `error`
    indexMetadata.error = String(e)
    await metadata.put(toMetadataKey(indexName), indexMetadata)
    throw e
  }
}

/**
 * 指定したノードのインデックスキーの一覧を返す。
 * 配列の値をインデックス化する場合、1 つのノードが複数のインデックスエントリーを生成することがある。
 *
 * 例:
 *  Node: { foo: [{ bar: `bar1`}, { bar: `bar2` }] }
 *  Index fields: [`foo.bar`] は次の要素を生成する: [`bar1`, `bar2`]
 *
 * 安定したソートのために、キーにはインデックス名の接頭辞とノードの counter の接尾辞が付く。
 *
 * あるインデックスフィールドにマテリアライズの結果（resolvedFields）が存在する場合は、
 *  それをキーの要素として使う。そうでなければノードの生の値を使う。
 */
function prepareIndexKeys(
  node: IGatsbyNode,
  resolvedFields: { [field: string]: unknown } | undefined,
  indexName: string,
  indexFields: IndexFields
): { keys: Array<IndexKey>; multiKeyFields: Array<string> } {
  // TODO: インデックス名ではなくインデックス id を使う（より短い）
  const indexKeyElements: Array<Array<IndexFieldValue>> = []
  const multiKeyFields: Array<string> = []

  indexKeyElements.push([indexName])
  for (const dottedField of indexFields.keys()) {
    const fieldValue = resolveFieldValue(dottedField, node, resolvedFields)
    let indexFieldValue = jsValueToLmdbKey(fieldValue)

    // lmdb のキーに保存できない値を受け取った
    if (typeof indexFieldValue === `undefined`) {
      const path = `${node.internal.type}.${dottedField} (id: ${node.id})`
      throw new Error(`Bad value at ${path}: ${inspect(fieldValue)}`)
    }
    indexFieldValue = Array.isArray(indexFieldValue)
      ? indexFieldValue.flat() // FIXME
      : [indexFieldValue]

    indexKeyElements.push(indexFieldValue)

    if (indexFieldValue.length > 1) {
      multiKeyFields.push(dottedField)
    }
  }
  indexKeyElements.push([node.internal.counter])

  return { keys: cartesianProduct(...indexKeyElements), multiKeyFields }
}

async function lockIndex(
  context: IIndexingContext,
  indexName: string
): Promise<void> {
  const { metadata } = context.databases
  const indexKey = toMetadataKey(indexName)

  const justLocked = await metadata.ifNoExists(indexKey, () => {
    metadata.put(indexKey, null)
  })
  if (!justLocked) {
    throw new Error(`Index is already locked`)
  }
}

async function indexReady(
  context: IIndexingContext,
  indexName: string
): Promise<IIndexMetadata> {
  return new Promise((resolve, reject) => {
    const { metadata } = context.databases

    let retries = 0
    let timeout = 16
    function poll(): void {
      const indexMetadata = metadata.get(toMetadataKey(indexName))
      if (indexMetadata?.state === `ready`) {
        resolve(indexMetadata)
        return
      }
      if (retries++ > 1000) {
        reject(new Error(`Index ${indexName} is locked for too long`))
        return
      }
      setTimeout(poll, timeout)
      timeout = Math.min(200, timeout * 1.5)
    }
    poll()
  })
}

/**
 * パラメーターに基づいてインデックス名を自動生成する。
 *
 * 例:
 *
 * buildIndexName(`Foo`, { foo: 1, bar: -1 }) -> `Foo/foo:1/bar:-1
 */
function buildIndexName(typeName: string, fields: IndexFields): string {
  const tokens: Array<string> = [typeName]

  for (const [field, sortDirection] of fields) {
    tokens.push(`${field}:${sortDirection}`)
  }

  return tokens.join(`/`)
}

function toMetadataKey(indexName: string): string {
  return `index:${indexName}`
}

function jsValueToLmdbKey(value: unknown): IndexFieldValue | undefined {
  if (
    typeof value === `number` ||
    typeof value === `string` ||
    typeof value === `boolean` ||
    value === null
  ) {
    return value
  }
  if (typeof value === `undefined`) {
    // `undefined` を含む配列のキーには、lmdb-store が対応していない
    //  しかし、それらのノードをインデックスから除外することはできない。
    //  フィルター { eq: null, gte: null, lte: null } は、そうしたノードを返すことが期待されるためである
    // さらに、lmdb-store はそれらのキーを他より前に置くが、ここでは下に置きたいので、
    //  追加のパディングを加える必要がある
    return undefinedSymbol
  }
  if (Array.isArray(value)) {
    const result: Array<IndexFieldValue> = []
    for (const item of value) {
      const lmdbKey = jsValueToLmdbKey(item)
      if (typeof lmdbKey === `undefined`) {
        return undefined // 不正な値
      }
      result.push(lmdbKey)
    }
    return result
  }
  // FIXME: これが望ましいかは分からないが、これに対するテストがある :/
  if (typeof value === `object`) {
    return JSON.stringify(value)
  }
  return undefined
}
