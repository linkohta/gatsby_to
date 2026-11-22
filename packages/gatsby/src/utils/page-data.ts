import { walkStream as fsWalkStream, Entry } from "@nodelib/fs.walk"
import fs from "fs-extra"
import reporter from "gatsby-cli/lib/reporter"
import fastq from "fastq"
import path from "path"
import { createContentDigest, generatePageDataPath } from "gatsby-core-utils"
import { websocketManager } from "./websocket-manager"
import { isWebpackStatusPending } from "./webpack-status"
import { store } from "../redux"
import type { IGatsbySlice, IGatsbyState } from "../redux/types"
import { hasFlag, FLAG_DIRTY_NEW_PAGE } from "../redux/reducers/queries"
import type GatsbyCacheLmdb from "./cache-lmdb"
import {
  constructPageDataString,
  reverseFixedPagePath,
  IPageData,
  IPageDataInput,
} from "./page-data-helpers"
import { Span } from "opentracing"

export { reverseFixedPagePath }
import { processNodeManifests } from "../utils/node-manifest"
import { IExecutionResult } from "../query/types"
import { getPageMode } from "./page-mode"
import { ICollectedSlices } from "./babel/find-slices"
import { ensureFileContent } from "./ensure-file-content"

export interface IPageDataWithQueryResult extends IPageData {
  result: IExecutionResult
}

export interface ISliceData {
  componentChunkName: string
  result: IExecutionResult
  staticQueryHashes: Array<string>
}

export async function readPageData(
  publicDir: string,
  pagePath: string
): Promise<IPageDataWithQueryResult> {
  const filePath = generatePageDataPath(publicDir, pagePath)
  const rawPageData = await fs.readFile(filePath, `utf-8`)
  return JSON.parse(rawPageData)
}

export async function removePageData(
  publicDir: string,
  pagePath: string
): Promise<void> {
  const filePath = generatePageDataPath(publicDir, pagePath)

  if (fs.existsSync(filePath)) {
    return await fs.remove(filePath)
  }

  return Promise.resolve()
}

export function pageDataExists(publicDir: string, pagePath: string): boolean {
  return fs.existsSync(generatePageDataPath(publicDir, pagePath))
}

let lmdbPageQueryResultsCache: GatsbyCacheLmdb
function getLMDBPageQueryResultsCache(): GatsbyCacheLmdb {
  if (!lmdbPageQueryResultsCache) {
    const GatsbyCacheLmdbImpl = require(`./cache-lmdb`).default
    lmdbPageQueryResultsCache = new GatsbyCacheLmdbImpl({
      name: `internal-tmp-query-results`,
      encoding: `string`,
    }).init()
  }
  return lmdbPageQueryResultsCache
}

let savePageQueryResultsPromise = Promise.resolve()

export function waitUntilPageQueryResultsAreStored(): Promise<void> {
  return savePageQueryResultsPromise
}

export async function savePageQueryResult(
  pagePath: string,
  stringifiedResult: string
): Promise<void> {
  savePageQueryResultsPromise = getLMDBPageQueryResultsCache().set(
    pagePath,
    stringifiedResult
  ) as Promise<void>
}

export async function readPageQueryResult(pagePath: string): Promise<string> {
  const stringifiedResult = await getLMDBPageQueryResultsCache().get(pagePath)
  if (typeof stringifiedResult === `string`) {
    return stringifiedResult
  }
  throw new Error(`Couldn't find temp query result for "${pagePath}".`)
}

export async function writePageData(
  publicDir: string,
  pageData: IPageDataInput,
  slicesUsedByTemplates: Map<string, ICollectedSlices>,
  slices: IGatsbyState["slices"]
): Promise<string> {
  const result = await readPageQueryResult(pageData.path)

  const outputFilePath = generatePageDataPath(publicDir, pageData.path)

  const body = constructPageDataString(
    pageData,
    result,
    slicesUsedByTemplates,
    slices
  )

  // 64 ビットの値が数値に収まるように、アセットのサイズを（バイトから）kB に変換する
  const pageDataSize = Buffer.byteLength(body) / 1000

  store.dispatch({
    type: `ADD_PAGE_DATA_STATS`,
    payload: {
      pagePath: pageData.path,
      filePath: outputFilePath,
      size: pageDataSize,
      pageDataHash: createContentDigest(body),
    },
  })

  await ensureFileContent(outputFilePath, body)
  return body
}

export async function writeSliceData(
  publicDir: string,
  { componentChunkName, name }: IGatsbySlice,
  staticQueryHashes: Array<string>
): Promise<string> {
  const result = JSON.parse(
    (await readPageQueryResult(`slice--${name}`)).toString()
  )

  const outputFilePath = path.join(publicDir, `slice-data`, `${name}.json`)

  const sliceData: ISliceData = {
    componentChunkName,
    result,
    staticQueryHashes,
  }

  const body = JSON.stringify(sliceData)

  const sliceDataSize = Buffer.byteLength(body) / 1000

  store.dispatch({
    type: `ADD_SLICE_DATA_STATS`,
    payload: {
      sliceName: name,
      filePath: outputFilePath,
      size: sliceDataSize,
      sliceDataHash: createContentDigest(body),
    },
  })

  await ensureFileContent(outputFilePath, body)
  return body
}

export async function readSliceData(
  publicDir: string,
  sliceName: string
): Promise<IPageDataWithQueryResult> {
  const filePath = path.join(publicDir, `slice-data`, `${sliceName}.json`)
  const rawPageData = await fs.readFile(filePath, `utf-8`)
  return JSON.parse(rawPageData)
}

let isFlushPending = false
let isFlushing = false

export function isFlushEnqueued(): boolean {
  return isFlushPending
}

let staleNodeManifests = false
const maxManifestIdsToLog = 50

type IDataTask =
  | {
      type: "page"
      pagePath: string
    }
  | {
      type: "slice"
      sliceName: string
    }

export async function flush(parentSpan?: Span): Promise<void> {
  if (isFlushing) {
    // すでに書き出しの途中である
    return
  }
  await waitUntilPageQueryResultsAreStored()
  isFlushPending = false
  isFlushing = true
  const {
    pendingPageDataWrites,
    pages,
    program,
    staticQueriesByTemplate,
    queries,
    slices,
    slicesByTemplate,
    nodeManifests,
  } = store.getState()
  const isBuild = program?._?.[0] !== `develop`

  const { pagePaths, sliceNames } = pendingPageDataWrites
  let writePageDataActivity

  let nodeManifestPagePathMap

  if (pagePaths.size > 0) {
    // ノードマニフェストをこの場所で処理するのは、page data に manifestId を追加する必要があるためである。
    // この manifestId は、ルーティングのときに page data が最新かどうかを判定するために使う。ここでは、ノードマニフェストファイルを処理して書き出しながら、"pagePath": "manifestId" のマップを作成する。
    // これは、保留中の page-data の書き込みがある場合にだけ行う。そうしないと、page-data.json ファイルが書き出される前に、保留中の createNodeManifest の呼び出しを処理してしまう可能性がある。その場合、それらの page-data ファイルには、対応するマニフェスト ID が書き込まれないことになる。
    nodeManifestPagePathMap = await processNodeManifests()
  } else if (nodeManifests.length > 0 && staleNodeManifests) {
    staleNodeManifests = false

    reporter.warn(
      `[gatsby] node manifests were created but no page-data.json files were written, so manifest ID's were not added to page-data.json files. This may be a bug or it may be due to a source plugin creating a node manifest for a node that did not change. Node manifest IDs: ${nodeManifests
        .map(n => n.manifestId)
        .slice(0, maxManifestIdsToLog)
        .join(`,`)}${
        nodeManifests.length > maxManifestIdsToLog
          ? ` There were ${
              nodeManifests.length - maxManifestIdsToLog
            } additional ID's that were not logged due to output length.`
          : ``
      }`
    )

    nodeManifestPagePathMap = await processNodeManifests()
  } else if (nodeManifests.length > 0) {
    staleNodeManifests = true
  }

  if (pagePaths.size > 0 || sliceNames.size > 0) {
    writePageDataActivity = reporter.createProgress(
      `Writing page-data.json and slice-data.json files to public directory`,
      pagePaths.size + sliceNames.size,
      0,
      { id: `write-page-data-public-directory`, parentSpan }
    )
    writePageDataActivity.start()
  }

  const flushQueue = fastq<void, IDataTask, boolean>(async (task, cb) => {
    if (task.type === `page`) {
      const { pagePath } = task
      const page = pages.get(pagePath)

      let shouldClearPendingWrite = true

      // ボンベイはどんよりした天気だ。短い話をしよう...
      // 昔々、page-data.json ファイルの書き込みはアトミックだった
      // この変更 (#24808) の後はそうではなくなった。つまり、
      // ページの保留中の書き込みを追加してから実際に書き出すまでの間に、
      // ページがもう存在しなくなっていることがある щ（ﾟДﾟщ）
      // だから、この確認が必要である
      if (page) {
        if (page.path && nodeManifestPagePathMap) {
          page.manifestId = nodeManifestPagePathMap.get(page.path)
        }

        if (!isBuild && process.env.GATSBY_QUERY_ON_DEMAND) {
          // このページのクエリをすでに実行したかを確認する
          // query-on-demand では、ページテンプレートに割り当てられた静的クエリの変更によって
          // 保留中の page-data の書き込みがあっても、そのクエリ結果は
          // まだないことがある
          const query = queries.trackedQueries.get(page.path)
          if (!query) {
            // これは決して起こらないはずである
            throw new Error(
              `We have a page, but we don't have registered query for it (???)`
            )
          }

          if (hasFlag(query.dirty, FLAG_DIRTY_NEW_PAGE)) {
            // クエリ結果はまだ書き出されていない
            setImmediate(() => cb(null, true))
            return
          }
        }

        // develop では QUERY_ON_DEMAND に頼っているので、そのまま通す
        // build では、SSG のページについてだけ、これらの page-json をビルドする
        if (!isBuild || (isBuild && getPageMode(page) === `SSG`)) {
          const staticQueryHashes =
            staticQueriesByTemplate.get(page.componentPath) || []

          try {
            const result = await writePageData(
              path.join(program.directory, `public`),
              {
                ...page,
                staticQueryHashes,
              },
              slicesByTemplate,
              slices
            )

            if (!isBuild) {
              websocketManager.emitPageData({
                id: pagePath,
                result: JSON.parse(result) as IPageDataWithQueryResult,
              })
            }
          } catch (e) {
            shouldClearPendingWrite = false
            reporter.panicOnBuild(
              `Failed to write page-data for ""${page.path}`,
              e
            )
          }
          writePageDataActivity.tick()
        }
      }

      if (shouldClearPendingWrite) {
        store.dispatch({
          type: `CLEAR_PENDING_PAGE_DATA_WRITE`,
          payload: {
            page: pagePath,
          },
        })
      }
    } else if (task.type === `slice`) {
      const { sliceName } = task
      const slice = slices.get(sliceName)
      if (slice) {
        const staticQueryHashes =
          staticQueriesByTemplate.get(slice.componentPath) || []

        const result = await writeSliceData(
          path.join(program.directory, `public`),
          slice,
          staticQueryHashes
        )

        writePageDataActivity.tick()

        if (!isBuild) {
          websocketManager.emitSliceData({
            id: sliceName,
            result: JSON.parse(result) as IPageDataWithQueryResult,
          })
        }
      }

      store.dispatch({
        type: `CLEAR_PENDING_SLICE_DATA_WRITE`,
        payload: {
          name: sliceName,
        },
      })
    }

    // 下の `setImmediate` は、SSG でないページが多いときに起きる
    // スタックオーバーフローへの回避策である
    setImmediate(() => cb(null, true))
    return
  }, 25)

  for (const pagePath of pagePaths) {
    flushQueue.push({ type: `page`, pagePath }, () => {})
  }
  for (const sliceName of sliceNames) {
    flushQueue.push({ type: `slice`, sliceName }, () => {})
  }

  if (!flushQueue.idle()) {
    await new Promise(resolve => {
      flushQueue.drain = resolve as () => unknown
    })
  }
  if (writePageDataActivity) {
    writePageDataActivity.end()
  }

  isFlushing = false

  return
}

export function enqueueFlush(parentSpan?: Span): void {
  if (isWebpackStatusPending()) {
    isFlushPending = true
  } else {
    flush(parentSpan)
  }
}

export async function handleStalePageData(parentSpan: Span): Promise<void> {
  if (!(await fs.pathExists(`public/page-data`))) {
    return
  }

  // public ディレクトリには、以前のビルドの古い page-data ファイルが残っていることがある
  // それらの一覧を取得して、期待される page-data ファイルと比較し、
  // もうあるべきでないものを削除する

  const activity = reporter.activityTimer(`Cleaning up stale page-data`, {
    parentSpan,
  })
  activity.start()

  const pageDataFilesFromPreviousBuilds = await new Promise<Set<string>>(
    (resolve, reject) => {
      const results = new Set<string>()

      const stream = fsWalkStream(`public/page-data`)

      stream.on(`data`, (data: Entry) => {
        if (data.name === `page-data.json`) {
          results.add(data.path)
        }
      })

      stream.on(`error`, e => {
        reject(e)
      })

      stream.on(`end`, () => resolve(results))
    }
  )

  const expectedPageDataFiles = new Set<string>()
  store.getState().pages.forEach(page => {
    expectedPageDataFiles.add(generatePageDataPath(`public`, page.path))
  })

  const deletionPromises: Array<Promise<void>> = []
  pageDataFilesFromPreviousBuilds.forEach(pageDataFilePath => {
    if (!expectedPageDataFiles.has(pageDataFilePath)) {
      deletionPromises.push(fs.remove(pageDataFilePath))
    }
  })

  await Promise.all(deletionPromises)

  activity.end()
}

interface IModifyPageDataForErrorMessage {
  errors: {
    graphql?: IPageDataWithQueryResult["result"]["errors"]
    getServerData?: IPageDataWithQueryResult["getServerDataError"]
  }
  graphqlExtensions?: IPageDataWithQueryResult["result"]["extensions"]
  pageContext?: IPageDataWithQueryResult["result"]["pageContext"]
  path: IPageDataWithQueryResult["path"]
  matchPath: IPageDataWithQueryResult["matchPath"]
  slicesMap: IPageDataWithQueryResult["slicesMap"]
}

export function modifyPageDataForErrorMessage(
  input: IPageDataWithQueryResult
): IModifyPageDataForErrorMessage {
  const optionalData = {
    ...(input.result?.pageContext
      ? { pageContext: input.result.pageContext }
      : {}),
    ...(input.result?.pageContext
      ? { pageContext: input.result.pageContext }
      : {}),
  }

  const optionalErrors = {
    ...(input.result?.errors ? { graphql: input.result.errors } : {}),
    ...(input.getServerDataError
      ? { getServerData: input.getServerDataError }
      : {}),
  }

  return {
    errors: {
      ...optionalErrors,
    },
    path: input.path,
    matchPath: input.matchPath,
    slicesMap: input.slicesMap,
    ...optionalData,
  }
}
