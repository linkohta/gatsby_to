import path from "path"
import os from "os"
import v8 from "v8"
import {
  existsSync,
  mkdtempSync,
  moveSync, // 注: renameSync ではなく moveSync を使う。/tmp が別のマウントにあるかもしれないため
  readFileSync,
  removeSync,
  writeFileSync,
  outputFileSync,
} from "fs-extra"
import {
  ICachedReduxState,
  IGatsbyNode,
  IGatsbyPage,
  GatsbyStateKeys,
} from "./types"
import { sync as globSync } from "glob"
import { createContentDigest } from "gatsby-core-utils"
import report from "gatsby-cli/lib/reporter"
import { DeepPartial } from "redux"

const getReduxCacheFolder = (): string =>
  // 誰かが process.chdir をする場合に備えて、これは関数にしている (#19800)
  path.join(process.cwd(), `.cache/redux`)

export const getWorkerSlicesFolder = (): string =>
  // 誰かが process.chdir をする場合に備えて、これは関数にしている (#19800)
  path.join(
    process.cwd(),
    `.cache/worker`,
    // テストでは、並行して動く jest のワーカーどうしが同じファイルを読み書きしたり、
    // 互いのファイルを消したりしないよう、テスト用のデータベース（datastore/lmdb/lmdb-datastore.ts）と
    // 同じくワーカーごとにフォルダーを分ける
    process.env.NODE_ENV === `test`
      ? `test-${process.env.FORCE_TEST_DATABASE_ID ?? process.env.JEST_WORKER_ID}`
      : ``
  )

function reduxSharedFile(dir: string): string {
  return path.join(dir, `redux.rest.state`)
}
function reduxChunkedNodesFilePrefix(dir: string): string {
  return path.join(dir, `redux.node.state_`)
}
function reduxChunkedPagesFilePrefix(dir: string): string {
  return path.join(dir, `redux.page.state_`)
}
function reduxWorkerSlicesPrefix(dir: string): string {
  return path.join(dir, `redux.worker.slices_`)
}

export function readFromCache(
  slices?: Array<GatsbyStateKeys>,
  optionalPrefix: string = ``
): DeepPartial<ICachedReduxState> {
  // キャッシュは 2 段階で保存される。ノードとページはチャンクに分けて、残りはまとめて保存する
  // まず残りを復元し、次に（あれば）ノードとページをそのオブジェクトに注入する
  // それぞれのチャンクは個別のファイルに保存する。これにより、コンテンツが _非常に_ 多い
  // サイトでもバッファー長の上限を回避できる。ノードとページはすべて Map に入るので、
  // 読み込む順序は関係ない。

  let cacheFolder = getReduxCacheFolder()

  if (slices) {
    cacheFolder = getWorkerSlicesFolder()

    return v8.deserialize(
      readFileSync(
        reduxWorkerSlicesPrefix(cacheFolder) +
          `${optionalPrefix}_` +
          createContentDigest(slices)
      )
    )
  }

  const obj: ICachedReduxState = v8.deserialize(
    readFileSync(reduxSharedFile(cacheFolder))
  )

  // 注: 100 万ページでは、これは 1M/chunkSize 個のチャンクになる（つまり 1m/10k=100）
  const nodesChunks = globSync(
    reduxChunkedNodesFilePrefix(cacheFolder) + `*`
  ).map(file => v8.deserialize(readFileSync(file)))

  const nodes: Array<[string, IGatsbyNode]> = [].concat(...nodesChunks)

  if (!nodesChunks.length) {
    report.info(
      `Cache exists but contains no nodes. There should be at least some nodes available so it seems the cache was corrupted. Disregarding the cache and proceeding as if there was none.`
    )
    return {} as DeepPartial<ICachedReduxState>
  }

  obj.nodes = new Map(nodes)

  // 注: 100 万ページでは、これは 1M/chunkSize 個のチャンクになる（つまり 1m/10k=100）
  const pagesChunks = globSync(
    reduxChunkedPagesFilePrefix(cacheFolder) + `*`
  ).map(file => v8.deserialize(readFileSync(file)))

  const pages: Array<[string, IGatsbyPage]> = [].concat(...pagesChunks)

  obj.pages = new Map(pages)

  return obj
}

export function guessSafeChunkSize(
  values: Array<[string, IGatsbyNode]> | Array<[string, IGatsbyPage]>,
  showMaxSizeWarning: boolean = false
): number {
  // ランダムにいくつかの要素を選んでサイズを測り、最悪のケースをもとにチャンクサイズの
  // 上限を決める。測定には 1 回ごとに時間がかかるので、トレードオフがある。
  // これは、ページが非常に大きい小規模なサイトで OOM になるのを防ごうとするものである。
  // たまたま最も小さいノードばかりを選んだ場合は、このヒューリスティックでも失敗しうる。
  // TODO: すべてのノードから選ぶのではなく、型ごとにいくつかのノードを測る

  const nodesToTest = 11 // かなり恣意的な数値
  const valueCount = values.length
  const step = Math.max(1, Math.ceil(valueCount / nodesToTest))
  let maxSize = 0
  for (let i = 0; i < valueCount; i += step) {
    const size = v8.serialize(values[i]).length
    maxSize = Math.max(size, maxSize)
  }

  // いずれかの chunkSize が約 500kb の上限を超えた場合に、警告を一度だけ送る
  if (showMaxSizeWarning && maxSize > 500000) {
    report.warn(
      `The size of at least one page context chunk exceeded 500kb, which could lead to degraded performance. Consider putting less data in the page context.`
    )
  }

  // Buffer の最大サイズは 2gb である（そう、64 ビットのシステムを前提にしている）
  // https://stackoverflow.com/questions/8974375/whats-the-maximum-size-of-a-node-js-buffer
  // 誤差の余裕を見て、1.5gb を目標の上限にする
  return Math.floor((1.5 * 1024 * 1024 * 1024) / maxSize)
}

function prepareCacheFolder(
  targetDir: string,
  contents: DeepPartial<ICachedReduxState>
): void {
  // ノードとページを一時的に退避して、メインの redux ストアから取り除く
  // これにより、ページのノードが全体で大量のデータを含む場合の OOM を防ぐ
  const nodesMap = contents.nodes
  contents.nodes = undefined

  const pagesMap = contents.pages
  contents.pages = undefined

  writeFileSync(reduxSharedFile(targetDir), v8.serialize(contents))

  // ここで redux ストアに戻す
  contents.nodes = nodesMap
  contents.pages = pagesMap

  if (nodesMap) {
    if (nodesMap.size === 0) {
      // ノードは実際には LMDB に保存される。
      // ただし、（キャッシュの読み込み時の）上の警告 "Cache exists but contains no nodes..." を
      // 回避するために、redux の状態に少なくとも 1 つのノードが必要である。
      const dummyNode: IGatsbyNode = {
        id: `dummy-node-id`,
        parent: ``,
        children: [],
        internal: {
          type: `DummyNode`,
          contentDigest: `dummy-node`,
          counter: 0,
          owner: ``,
        },
        fields: [],
      }
      nodesMap.set(dummyNode.id, dummyNode)
    }
    // 次にノードを別に保存する。チャンクサイズはヒューリスティックで決める
    const values: Array<[string, IGatsbyNode]> = [...nodesMap.entries()]
    const chunkSize = guessSafeChunkSize(values)
    const chunks = Math.ceil(values.length / chunkSize)

    for (let i = 0; i < chunks; ++i) {
      writeFileSync(
        reduxChunkedNodesFilePrefix(targetDir) + i,
        v8.serialize(values.slice(i * chunkSize, i * chunkSize + chunkSize))
      )
    }
  }

  if (pagesMap) {
    // 次にノードを別に保存する。チャンクサイズはヒューリスティックで決める
    const values: Array<[string, IGatsbyPage]> = [...pagesMap.entries()]
    const chunkSize = guessSafeChunkSize(values, true)
    const chunks = Math.ceil(values.length / chunkSize)

    for (let i = 0; i < chunks; ++i) {
      writeFileSync(
        reduxChunkedPagesFilePrefix(targetDir) + i,
        v8.serialize(values.slice(i * chunkSize, i * chunkSize + chunkSize))
      )
    }
  }
}

function safelyRenameToBak(cacheFolder: string): string {
  // 要するに、以前に名前を変えたキャッシュが何らかの理由で削除されずに残っている
  // 可能性を回避しようとしている。_それ_ が妨げになるべきではない。
  const tmpSuffix = `.bak`
  let suffixCounter = 0
  let bakName = cacheFolder + tmpSuffix // 番号なしから始める

  while (existsSync(bakName)) {
    ++suffixCounter
    bakName = cacheFolder + tmpSuffix + suffixCounter
  }
  moveSync(cacheFolder, bakName)

  return bakName
}

export function writeToCache(
  contents: DeepPartial<ICachedReduxState>,
  slices?: Array<GatsbyStateKeys>,
  optionalPrefix: string = ``
): void {
  // "slices" も "redux" フォルダーに書き込むと、たとえばフォルダー全体が置き換えられたときに
  // 一部の "slices" が失われる、といった分かりにくいバグが入り込む
  // そのため、専用の "worker" フォルダーに書き込む
  if (slices) {
    const cacheFolder = getWorkerSlicesFolder()

    outputFileSync(
      reduxWorkerSlicesPrefix(cacheFolder) +
        `${optionalPrefix}_` +
        createContentDigest(slices),
      v8.serialize(contents)
    )
    return
  }

  // 注: これはトランザクション的な操作であるべきである。そのため一時ディレクトリで作業し、
  // エラーによってキャッシュが壊れうる状態で残らないようにする。

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), `reduxcache`)) // linux / windows

  prepareCacheFolder(tmpDir, contents)

  // 古いキャッシュフォルダーを新しいものに置き換える。最初の rename が失敗した場合、
  // キャッシュは古いままになるだけである。2 番目の rename が失敗した場合、キャッシュは空になる。
  // どちらの場合も、キャッシュが壊れた状態で残ることはない。

  const reduxCacheFolder = getReduxCacheFolder()

  let bakName = ``
  if (existsSync(reduxCacheFolder)) {
    // 入れ替えが終わるまでは削除しない（rename のほうが失敗しにくい）
    bakName = safelyRenameToBak(reduxCacheFolder)
  }

  // この時点で redux のキャッシュフォルダーは存在しないはずなので、一時フォルダーをその名前に変更できる
  moveSync(tmpDir, reduxCacheFolder)

  // 最後に、古いキャッシュフォルダーの削除を、失敗を気にせずに試みる
  try {
    if (bakName !== ``) {
      removeSync(bakName)
    }
  } catch (e) {
    report.warn(
      `Non-fatal: Deleting the old cache folder failed, left behind in \`${bakName}\`. Rimraf reported this error: ${e}`
    )
  }
}
