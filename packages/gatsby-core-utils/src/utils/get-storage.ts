import path from "path"
import { getLmdb } from "./get-lmdb"
import type { RootDatabase, Database } from "lmdb"
import type { Headers } from "got"

export enum LockStatus {
  Locked = 0,
  Unlocked = 1,
}

interface ICoreUtilsDatabase {
  remoteFileInfo: Database<
    {
      extension: string
      headers: Headers
      path: string
      directory: string
      cacheKey?: string
      buildId: string
    },
    string
  >
  mutex: Database<LockStatus, string>
}

let databases: ICoreUtilsDatabase | undefined
let rootDb: RootDatabase

export function getDatabaseDir(): string {
  const rootDir = global.__GATSBY?.root ?? process.cwd()
  return path.join(rootDir, `.cache`, `data`, `gatsby-core-utils`)
}

export function getStorage(fullDbPath: string): ICoreUtilsDatabase {
  if (!databases) {
    if (!fullDbPath) {
      throw new Error(`LMDB path is not set!`)
    }

    // __GATSBY_OPEN_LMDBS は、このプロセスで対象の db をすでに開いたかどうかを追跡する
    // `gatsby serve` の場合は 2 回開こうとすることがある。1 回はエンジン用、
    // もう 1 回は `SitePage` ノードへアクセスするため（末尾のスラッシュのリダイレクトを行う
    // ミドルウェアで使う）である。これにより、プロセス内のインスタンスが 1 つになる。
    // 複数のインスタンスを使うと、原因の分かりにくいエラーがランダムに起きるようである。
    if (!globalThis.__GATSBY_OPEN_LMDBS) {
      globalThis.__GATSBY_OPEN_LMDBS = new Map()
    }

    databases = globalThis.__GATSBY_OPEN_LMDBS.get(fullDbPath)

    if (databases) {
      return databases
    }

    const open = getLmdb().open

    rootDb = open({
      name: `root`,
      path: fullDbPath,
      compression: true,
      sharedStructuresKey: Symbol.for(`structures`),
    })

    databases = {
      remoteFileInfo: rootDb.openDB({
        name: `remote-file`,
      }),
      mutex: rootDb.openDB({
        name: `mutex`,
      }),
    }

    globalThis.__GATSBY_OPEN_LMDBS.set(fullDbPath, databases)
  }

  return databases as ICoreUtilsDatabase
}

export async function closeDatabase(): Promise<void> {
  if (rootDb) {
    await rootDb.close()
    databases = undefined
  }
}
