import { RootDatabase, open, RangeIterable } from "lmdb"
// import { performance } from "perf_hooks"
import { ActionsUnion, IGatsbyNode } from "../../redux/types"
import { updateNodes } from "./updates/nodes"
import { updateNodesByType } from "./updates/nodes-by-type"
import { IDataStore, ILmdbDatabases, IQueryResult } from "../types"
import { emitter, replaceReducer } from "../../redux"
import { GatsbyIterable } from "../common/iterable"
import { doRunQuery } from "./query/run-query"
import {
  IRunFilterArg,
  runFastFiltersAndSort,
} from "../in-memory/run-fast-filters"

const lmdbDatastore = {
  getNode,
  getTypes,
  countNodes,
  iterateNodes,
  iterateNodesByType,
  updateDataStore,
  ready,
  runQuery,

  // 非推奨:
  getNodes,
  getNodesByType,
}

const preSyncDeletedNodeIdsCache = new Set()

export function getDefaultDbPath(): string {
  const dbFileName =
    process.env.NODE_ENV === `test`
      ? `test-datastore-${
          // jest のテスト実行時にワーカーのコンテキストで実行された場合は、FORCE_TEST_DATABASE_ID が
          // 設定される。テストのコンテキストで直接実行された場合は、JEST_WORKER_ID が設定される
          // （jest は内部で jest-worker を使う）。
          process.env.FORCE_TEST_DATABASE_ID ?? process.env.JEST_WORKER_ID
        }`
      : `datastore`

  return process.cwd() + `/.cache/data/` + dbFileName
}

let fullDbPath
let rootDb
let databases

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace NodeJS {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface Global {
      __GATSBY_OPEN_LMDBS?: Map<string, ILmdbDatabases>
      __GATSBY_OPEN_ROOT_LMDBS?: Map<string, RootDatabase>
    }
  }
}

function getRootDb(): RootDatabase {
  if (!rootDb) {
    if (!fullDbPath) {
      throw new Error(`LMDB path is not set!`)
    }

    if (!globalThis.__GATSBY_OPEN_ROOT_LMDBS) {
      globalThis.__GATSBY_OPEN_ROOT_LMDBS = new Map()
    }
    rootDb = globalThis.__GATSBY_OPEN_ROOT_LMDBS.get(fullDbPath)
    if (rootDb) {
      return rootDb
    }

    rootDb = open({
      name: `root`,
      path: fullDbPath,
      compression: true,
    })

    globalThis.__GATSBY_OPEN_ROOT_LMDBS.set(fullDbPath, rootDb)
  }
  return rootDb
}

function getDatabases(): ILmdbDatabases {
  if (!databases) {
    // __GATSBY_OPEN_LMDBS は、このプロセスで指定した db をすでに開いたかどうかを追跡する
    // `gatsby serve` の場合は 2 回開こうとすることがある。1 回はエンジンのため、
    // もう 1 回は `SitePage` ノードへアクセスするためである（末尾のスラッシュの
    // リダイレクトミドルウェアに使う）。これにより、プロセス内のインスタンスが 1 つであることを保証する。
    // 複数のインスタンスを使うと、奇妙でランダムなエラーが起きるようである。
    if (!globalThis.__GATSBY_OPEN_LMDBS) {
      globalThis.__GATSBY_OPEN_LMDBS = new Map()
    }
    databases = globalThis.__GATSBY_OPEN_LMDBS.get(fullDbPath)
    if (databases) {
      return databases
    }

    const rootDb = getRootDb()
    databases = {
      nodes: rootDb.openDB({
        name: `nodes`,
        // FIXME: sharedStructuresKey はテストを壊す。おそらく DELETE_CACHE で何らかのクリーンアップが必要である
        // sharedStructuresKey: Symbol.for(`structures`),
        // @ts-ignore
        cache: {
          // expirer: false は LRU の部分を無効にし、WeakRef だけを扱う
          // こうすることでノードを強参照で保持しないが、すでに読み込まれている
          // 場合は引き続き再利用する
          expirer: false,
        },
      }),
      nodesByType: rootDb.openDB({
        name: `nodesByType`,
        dupSort: true,
      }),
      metadata: rootDb.openDB({
        name: `metadata`,
        useVersions: true,
      }),
      indexes: rootDb.openDB({
        name: `indexes`,
        // TODO: 準備ができたら dupSort を使う: https://github.com/DoctorEvidence/lmdb-store/issues/66
        // dupSort: true
      }),
    }
    globalThis.__GATSBY_OPEN_LMDBS.set(fullDbPath, databases)
  }
  return databases
}

/**
 * @deprecated
 */
function getNodes(): Array<IGatsbyNode> {
  // const start = performance.now()
  const result = Array.from<IGatsbyNode>(iterateNodes())
  // const timeTotal = performance.now() - start
  // console.warn(
  //   `getNodes() is deprecated, use iterateNodes() instead; ` +
  //     `array length: ${result.length}; time(ms): ${timeTotal}`
  // )
  return result ?? []
}

/**
 * @deprecated
 */
function getNodesByType(type: string): Array<IGatsbyNode> {
  // const start = performance.now()
  const result = Array.from<IGatsbyNode>(iterateNodesByType(type))
  // const timeTotal = performance.now() - start
  // console.warn(
  //   `getNodesByType() is deprecated, use iterateNodesByType() instead; ` +
  //     `array length: ${result.length}; time(ms): ${timeTotal}`
  // )
  return result ?? []
}

function iterateNodes(): GatsbyIterable<IGatsbyNode> {
  // lmdb-store のキャッシュを活用するため、項目を id でも取得する
  const nodesDb = getDatabases().nodes
  return new GatsbyIterable(
    nodesDb
      .getKeys({ snapshot: false })
      .map(nodeId => (typeof nodeId === `string` ? getNode(nodeId) : undefined))
      .filter(Boolean) as RangeIterable<IGatsbyNode>
  )
}

function iterateNodesByType(type: string): GatsbyIterable<IGatsbyNode> {
  const nodesByType = getDatabases().nodesByType
  return new GatsbyIterable(
    nodesByType
      .getValues(type)
      .map(nodeId => getNode(nodeId))
      .filter(Boolean) as RangeIterable<IGatsbyNode>
  )
}

function getNode(id: string): IGatsbyNode | undefined {
  if (!id || preSyncDeletedNodeIdsCache.has(id)) {
    return undefined
  }

  const { nodes } = getDatabases()
  return nodes.get(id)
}

function getTypes(): Array<string> {
  // lmdb 3 の `asArray` は型のうえでは Promise なので、同期的に配列へ変換する
  return Array.from(getDatabases().nodesByType.getKeys({})) as Array<string>
}

function countNodes(typeName?: string): number {
  if (!typeName) {
    const stats = getDatabases().nodes.getStats() as { entryCount: number }
    return Math.max(
      Number(stats.entryCount) - preSyncDeletedNodeIdsCache.size,
      0
    ) // FIXME: sharedStructuresKey を元に戻すときに -1 を追加する
  }

  const { nodesByType } = getDatabases()
  return nodesByType.getValuesCount(typeName)
}

async function runQuery(args: IRunFilterArg): Promise<IQueryResult> {
  if (process.env.GATSBY_EXPERIMENTAL_LMDB_INDEXES) {
    return await doRunQuery({
      datastore: lmdbDatastore,
      databases: getDatabases(),
      ...args,
    })
  }
  return Promise.resolve(runFastFiltersAndSort(args))
}

let lastOperationPromise: Promise<any> = Promise.resolve()

function updateDataStore(action: ActionsUnion): void {
  switch (action.type) {
    case `DELETE_CACHE`: {
      const dbs = getDatabases()
      // 同期的なコミットを強制する
      dbs.nodes.transactionSync(() => {
        dbs.nodes.clearSync()
        dbs.nodesByType.clearSync()
        dbs.metadata.clearSync()
        dbs.indexes.clearSync()
      })
      break
    }
    case `SET_PROGRAM`: {
      // TODO: lmdb がインクリメンタルなインデックスに対応したら、これを削除する
      clearIndexes()
      break
    }
    case `CREATE_NODE`:
    case `DELETE_NODE`:
    case `ADD_FIELD_TO_NODE`:
    case `ADD_CHILD_NODE_TO_PARENT_NODE`:
    case `MATERIALIZE_PAGE_MODE`: {
      const dbs = getDatabases()
      const operationPromise = Promise.all([
        updateNodes(dbs.nodes, action),
        updateNodesByType(dbs.nodesByType, action),
      ])
      lastOperationPromise = operationPromise

      // 同じトランザクションで削除と作成の両方が使われた場合は、キャッシュから取り除くべきである
      if (action.type === `CREATE_NODE`) {
        preSyncDeletedNodeIdsCache.delete(action.payload.id)
      }

      if (action.type === `DELETE_NODE` && action.payload?.id) {
        preSyncDeletedNodeIdsCache.add(action.payload.id)
        operationPromise.then(() => {
          // その間に他の操作が行われていない場合にだけクリアする
          if (lastOperationPromise === operationPromise) {
            preSyncDeletedNodeIdsCache.clear()
          }
        })
      }
    }
  }
}

function clearIndexes(): void {
  const dbs = getDatabases()
  dbs.nodes.transactionSync(() => {
    dbs.metadata.clearSync()
    dbs.indexes.clearSync()
  })
}

/**
 * すべてのデータが同期されたときに解決される
 */
async function ready(): Promise<void> {
  await lastOperationPromise
}

export function setupLmdbStore({
  dbPath = getDefaultDbPath(),
}: { dbPath?: string } = {}): IDataStore {
  fullDbPath = dbPath

  replaceReducer({
    nodes: (state = new Map(), action) =>
      action.type === `DELETE_CACHE` ? new Map() : state,
    nodesByType: (state = new Map(), action) =>
      action.type === `DELETE_CACHE` ? new Map() : state,
  })
  emitter.on(`*`, action => {
    if (action) {
      updateDataStore(action)
    }
  })
  // TODO: lmdb がインクリメンタルなインデックスに対応したら、これを削除する
  clearIndexes()
  return lmdbDatastore
}
