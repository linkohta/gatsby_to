/*
 * サービスロック: Gatsby の develop プロセスのサービスディスカバリーを担う
 * 問題: develop プロセスは、プロキシサーバー、実際の develop プロセス、通信用の websocket サーバーを起動する。後ろの 2 つはポートがランダムなので、探し出す必要がある。また、同じサイトを同時に複数起動することはできない。
 * 解決策: ロックファイルを使う。`.config/gatsby/sites/${sitePathHash} にフォルダーを作り、サービスごとにそのデータを JSON ファイル（developstatusserver.json など）に書き出し、そのファイルを（developstatusserver.json.lock で）ロックして、同じサービスを誰も再び起動できないようにする。
 *
 * NOTE(@mxstbr): これは Node.js 固有の API に依存しているが、core-utils はブラウザー環境でも使われるので、メインの index.ts からは export していない。https://github.com/jprichardson/node-fs-extra/issues/743 を参照
 */
import path from "path"
import tmp from "tmp"
import fs from "fs-extra"
import xdgBasedir from "xdg-basedir"
import { createContentDigest } from "./create-content-digest"
import { isCI } from "./ci"

const globalConfigPath = xdgBasedir.config || tmp.fileSync().name

const getSiteDir = (programPath: string): string => {
  const hash = createContentDigest(programPath)

  return path.join(globalConfigPath, `gatsby`, `sites`, hash)
}

const DATA_FILE_EXTENSION = `.json`
const getDataFilePath = (siteDir: string, serviceName: string): string =>
  path.join(siteDir, `${serviceName}${DATA_FILE_EXTENSION}`)

const lockfileOptions = {
  // stale とみなすまでの時間は最小値を使う
  stale: 5000,
}

export type UnlockFn = () => Promise<void>

// proper-lockfile には副作用があるので、必要なときにだけ設定したい
function getLockFileInstance(): typeof import("proper-lockfile") {
  return import(`proper-lockfile`)
}

const memoryServices = {}
export const createServiceLock = async (
  programPath: string,
  serviceName: string,
  content: Record<string, any>
): Promise<UnlockFn | null> => {
  // NOTE(@mxstbr): CI ではグローバルの設定ディレクトリに確実にアクセスできるとは限らず、そもそもプロセス間の調整も必要ない
  // そのため、代わりにサービスをメモリ上に保存する
  if (isCI()) {
    if (memoryServices[serviceName]) return null

    memoryServices[serviceName] = content
    return async (): Promise<void> => {
      delete memoryServices[serviceName]
    }
  }

  const siteDir = getSiteDir(programPath)

  await fs.ensureDir(siteDir)

  const serviceDataFile = getDataFilePath(siteDir, serviceName)

  try {
    await fs.writeFile(serviceDataFile, JSON.stringify(content))

    const lockfile = await getLockFileInstance()
    const unlock = await lockfile.lock(serviceDataFile, lockfileOptions)

    return unlock
  } catch (err) {
    return null
  }
}

export const getService = async <T = Record<string, unknown>>(
  programPath: string,
  serviceName: string,
  ignoreLockfile: boolean = false
): Promise<T | null> => {
  if (isCI()) return memoryServices[serviceName] || null

  const siteDir = getSiteDir(programPath)
  const serviceDataFile = getDataFilePath(siteDir, serviceName)

  try {
    const lockfile = await getLockFileInstance()
    if (
      ignoreLockfile ||
      (await lockfile.check(serviceDataFile, lockfileOptions))
    ) {
      return JSON.parse(
        await fs.readFile(serviceDataFile, `utf8`).catch(() => `null`)
      )
    }

    return null
  } catch (err) {
    return null
  }
}

export const getServices = async (programPath: string): Promise<any> => {
  if (isCI()) return memoryServices
  const siteDir = getSiteDir(programPath)

  const serviceNames = (await fs.readdir(siteDir))
    .filter(file => file.endsWith(DATA_FILE_EXTENSION))
    .map(file => file.replace(DATA_FILE_EXTENSION, ``))

  const services = {}
  await Promise.all(
    serviceNames.map(async service => {
      services[service] = await getService(programPath, service, true)
    })
  )

  return services
}
