import { open, RootDatabase, Database, DatabaseOptions } from "lmdb"
import * as fs from "fs-extra"
import * as path from "path"

// 通常の GatsbyCache は "caches" に保存するので、これは "caches-lmdb" にする
const cacheDbFile =
  process.env.NODE_ENV === `test`
    ? `caches-lmdb-${
        // jest のテストの実行時に、これがワーカーのコンテキストで実行されると、FORCE_TEST_DATABASE_ID が
        // 設定される。テストのコンテキストで直接実行されると、JEST_WORKER_ID が設定される
        // （jest は内部で jest-worker を使う）。
        process.env.FORCE_TEST_DATABASE_ID ?? process.env.JEST_WORKER_ID
      }`
    : `caches-lmdb`

const dbPath = path.join(
  global.__GATSBY?.root || process.cwd(),
  `.cache/${cacheDbFile}`
)

function getAlreadyOpenedStore(): RootDatabase | undefined {
  if (!globalThis.__GATSBY_OPEN_ROOT_LMDBS) {
    globalThis.__GATSBY_OPEN_ROOT_LMDBS = new Map()
  }
  return globalThis.__GATSBY_OPEN_ROOT_LMDBS.get(dbPath)
}

export default class GatsbyCacheLmdb {
  private db: Database | undefined
  private encoding: DatabaseOptions[`encoding`]
  public readonly name: string
  // キャッシュディレクトリにデータを書き込みたいプラグインのために必要である
  public readonly directory: string
  // TODO: v4 で `.cache` を削除する。これは互換モードである。cache-manager のキャッシュ実装は
  // 内部のキャッシュを公開しており、公開のキャッシュインターフェースにはなかった `.del` 関数を
  // 使えるようにしていた（gatsby-plugin-sharp が、不要になったデータを消去するために使っている）
  public readonly cache: GatsbyCacheLmdb

  constructor({
    name = `db`,
    encoding = `json`,
  }: {
    name: string
    encoding?: DatabaseOptions[`encoding`]
  }) {
    this.name = name
    this.encoding = encoding
    this.directory = path.join(process.cwd(), `.cache/caches/${name}`)
    this.cache = this
  }

  init(): GatsbyCacheLmdb {
    fs.ensureDirSync(this.directory)
    return this
  }

  private static getStore(): RootDatabase {
    let rootDb = getAlreadyOpenedStore()
    if (rootDb) {
      return rootDb
    }

    rootDb = open({
      name: `root`,
      path: dbPath,
      compression: true,
      maxDbs: 200,
    })

    globalThis.__GATSBY_OPEN_ROOT_LMDBS.set(dbPath, rootDb)

    return rootDb
  }

  private getDb(): Database {
    if (!this.db) {
      this.db = GatsbyCacheLmdb.getStore().openDB({
        name: this.name,
        encoding: this.encoding,
      })
    }
    return this.db
  }

  async get<T = unknown>(key): Promise<T | undefined> {
    return this.getDb().get(key)
  }

  async set<T>(key: string, value: T): Promise<T | undefined> {
    await this.getDb().put(key, value)
    return value
  }

  async del(key: string): Promise<void> {
    return this.getDb().remove(key) as unknown as Promise<void>
  }
}

export async function resetCache(): Promise<void> {
  const store = getAlreadyOpenedStore()
  if (store) {
    await store.close()
    globalThis.__GATSBY_OPEN_ROOT_LMDBS.delete(dbPath)
  }

  await fs.emptyDir(dbPath)
}
