import * as path from "path"
import { store, emitter } from "../redux"
import { IClearPendingPageDataWriteAction } from "../redux/types"
import {
  IPageDataWithQueryResult,
  readPageData as readPageDataUtil,
} from "./page-data"

const DEFAULT_WAIT_TIMEOUT = 15 * 1000
export const RETRY_INTERVAL = 5 * 1000

export async function getPageData(
  pagePath: string,
  waitForMS: number = DEFAULT_WAIT_TIMEOUT
): Promise<IPageDataWithQueryResult> {
  return doGetPageData(pagePath, waitForMS, waitForMS)
}

async function doGetPageData(
  pagePath: string,
  waitForMS: number,
  initialWaitForMs: number
): Promise<IPageDataWithQueryResult> {
  const { queries, pendingPageDataWrites, pages } = store.getState()

  if (!pages.has(pagePath)) {
    throw new Error(
      `Page "${pagePath}" doesn't exist. It might have been deleted recently.`
    )
  }

  const query = queries.trackedQueries.get(pagePath)

  if (!query) {
    throw new Error(`Could not find query ${pagePath}`)
  }
  if (query.running !== 0) {
    return waitNextPageData(pagePath, waitForMS, initialWaitForMs)
  }
  if (query.dirty !== 0) {
    emitter.emit(`QUERY_RUN_REQUESTED`, { pagePath })
    return waitNextPageData(pagePath, waitForMS, initialWaitForMs)
  }
  if (pendingPageDataWrites.pagePaths.has(pagePath)) {
    return waitNextPageData(pagePath, waitForMS, initialWaitForMs)
  }
  // 結果は最新である
  return readPageData(pagePath)
}

async function waitNextPageData(
  pagePath: string,
  remainingTime: number,
  initialWaitForMs: number
): Promise<IPageDataWithQueryResult> {
  if (remainingTime > 0) {
    return new Promise(resolve => {
      emitter.on(`CLEAR_PENDING_PAGE_DATA_WRITE`, listener)

      const timeout = setTimeout(
        (): void => {
          emitter.off(`CLEAR_PENDING_PAGE_DATA_WRITE`, listener)
          resolve(
            doGetPageData(
              pagePath,
              Math.max(remainingTime - RETRY_INTERVAL, 0),
              initialWaitForMs
            )
          )
        },
        Math.min(RETRY_INTERVAL, remainingTime)
      )

      function listener(data: IClearPendingPageDataWriteAction): void {
        if (data.payload.page === pagePath) {
          clearTimeout(timeout)
          emitter.off(`CLEAR_PENDING_PAGE_DATA_WRITE`, listener)
          // page-data は書き出されたが、その間にクエリに古いという印が付いていないかは分からない
          // そのため `doGetPageData` をもう一度呼ぶ。これは確認を行い、新しい結果を待つか、
          // 古くなっていなければすぐに解決する。
          // 残り時間の変更は実際には「正確」ではないが、タイムアウトは全体として、最終的に必ず
          // 解決（または reject）することを保証するためのものであり、100% 正確である必要はない。
          // 無限ループの状況に陥らないように、少しずつ減らしている。
          // また、`doGetPageData` の呼び出しを遅らせる必要もある。これは同じ tick の中で、別の `CLEAR_PENDING_PAGE_DATA_WRITE` の
          // コールバックを追加することがあり、`mett` がそのコールバックを実行してしまうためである（現在のコールバックが終わる前に起き、
          // `mett` は、メッセージが発行される前に登録されたコールバックだけを実行することを保証しない）
          process.nextTick(() =>
            resolve(
              doGetPageData(
                pagePath,
                Math.max(remainingTime - RETRY_INTERVAL / 5, 0),
                initialWaitForMs
              )
            )
          )
        }
      }
    })
  } else {
    // 理想的ではないが ... 手元にあるかもしれない（古い）結果を送ることを試みる。
    // それもなければ失敗させる（reject する）
    return readPageData(pagePath).catch(() => {
      throw new Error(
        `Couldn't get query results for "${pagePath}" in ${(
          initialWaitForMs / 1000
        ).toFixed(3)}s.`
      )
    })
  }
}

async function readPageData(pagePath): Promise<IPageDataWithQueryResult> {
  const { program } = store.getState()

  try {
    return await readPageDataUtil(
      path.join(program.directory, `public`),
      pagePath
    )
  } catch (err) {
    throw new Error(
      `Error loading a result for the page query in "${pagePath}". Query was not run and no cached result was found.`
    )
  }
}
