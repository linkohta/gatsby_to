import { Response } from "express"
import * as path from "path"
import { fixedPagePath } from "gatsby-core-utils"
import { findPageByPath } from "./find-page-by-path"
import { readPageData } from "./page-data"
import { store } from "../redux"
import { getPageMode } from "./page-mode"

/**
 * .html ファイルのレスポンスに preload の link ヘッダーを追加する。これにより、ブラウザーは重要なリソースの取得を前もって予約でき、
 * ページをより速くレンダリングできる。これがないと、ネットワークのウォーターフォールが発生する（js のスクリプトを取得 -> パースして実行 -> データのダウンロードを開始）
 * これがあれば、JS が実行される前にデータのダウンロードを開始できる。
 */
export async function appendPreloadHeaders(
  requestPath: string,
  res: Response
): Promise<void> {
  // common.js と socket.io.js の preload ヘッダーを追加する
  // TODO: socket.io の部分をブロッキングでなくする。ページのレンダリングにはもう必要ない
  res.append(`Link`, `</commons.js>; rel=preload; as=script`)
  res.append(`Link`, `</socket.io/socket.io.js>; rel=preload; as=script`)

  const page = findPageByPath(store.getState(), requestPath, true)
  // 404 ページにフォールバックするので、ページは常に存在するはずである（最悪でも dev-404）
  // これは、何も見つからなかった場合にサーバーをクラッシュさせないための、念のための確認である
  if (page) {
    // app-data.json の preload を追加する
    res.append(
      `Link`,
      `</page-data/app-data.json>; rel=preload; as=fetch ; crossorigin`
    )

    // page-data.json の preload を追加する
    // ランタイムは、レンダリングするだけでも 404 と dev-404 の page-data の取得を要求する（cache-dir/app.js を参照）
    const pagePathsToPreload = [`/404.html`, `/dev-404-page/`]
    if (
      getPageMode(page) !== `SSR` &&
      !pagePathsToPreload.includes(page.path)
    ) {
      // ページのパスが最初になるようにする（順序は問題にならないはずだが、分かりやすい順序にするため）
      pagePathsToPreload.unshift(page.path)
    }

    const staticQueriesToPreload = new Set<string>()
    for (const pagePath of pagePathsToPreload) {
      res.append(
        `Link`,
        `</${path.join(
          `page-data`,
          encodeURI(fixedPagePath(pagePath)),
          `page-data.json`
        )}>; rel=preload; as=fetch ; crossorigin`
      )

      try {
        const pageData = await readPageData(
          path.join(store.getState().program.directory, `public`),
          pagePath
        )

        // 必要な静的クエリを順に処理して、preload する静的クエリの Set に追加する
        // Set を使うことで、リクエストされたページと 404 ページがクエリを共有している場合でも、重複しないことが保証される。
        for (const staticQueryHash of pageData.staticQueryHashes) {
          staticQueriesToPreload.add(staticQueryHash)
        }
      } catch (e) {
        // タイミングの都合でこれが失敗することがある。ページが追加されたばかりで、page-data ファイルが
        // まだ作成されていない場合である（ページはすでに存在するが、page-data はまだない）
        // そのような場合は何もしない
      }
    }

    // 読み込むページから集めた静的クエリを追加する
    for (const staticQueryHash of staticQueriesToPreload) {
      res.append(
        `Link`,
        `</page-data/sq/d/${staticQueryHash}.json>; rel=preload; as=fetch ; crossorigin`
      )
    }
  } else {
    // 上の前提が誤っていた場合に preload ヘッダーを追加していないケースを見つけるために、
    // 実際には何も返されないケースを追跡すべきか？
  }
}
