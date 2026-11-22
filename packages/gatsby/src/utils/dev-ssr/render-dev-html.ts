import { WorkerPool } from "gatsby-worker"
import fs from "fs-extra"
import nodePath from "path"
import report from "gatsby-cli/lib/reporter"
import { isCI } from "gatsby-core-utils"
import type { Request } from "express"
import { ROUTES_DIRECTORY } from "../../constants"
import { startListener } from "../../bootstrap/requires-writer"
import { findPageByPath } from "../find-page-by-path"
import { getPageData as getPageDataExperimental } from "../get-page-data"
import { getDevSSRWebpack } from "../../commands/build-html"
import { GatsbyReduxStore } from "../../redux"
import { IGatsbyPage } from "../../redux/types"
import { getServerData, IServerData } from "../get-server-data"
import { getPageMode } from "../page-mode"
import { parseError, IErrorRenderMeta } from "./parse-error"

type GatsbyDevSSRWorkerPool = WorkerPool<
  typeof import("./render-dev-html-child")
>

const startWorker = (): GatsbyDevSSRWorkerPool => {
  const newWorker = new WorkerPool<typeof import("./render-dev-html-child")>(
    require.resolve(`./render-dev-html-child`),
    {
      numWorkers: 1,
      env: {
        NODE_ENV: isCI() ? `production` : `development`,
        forceColors: `true`,
        GATSBY_EXPERIMENTAL_DEV_SSR: `true`,
      },
    }
  )

  return newWorker
}

let worker: GatsbyDevSSRWorkerPool
export const initDevWorkerPool = (): void => {
  worker = startWorker()
}

let changeCount = 0
export const restartWorker = (htmlComponentRendererPath: string): void => {
  changeCount += 1
  // fork はコストが高い。出力された webpack のファイルを require し直すたびに、
  // メモリーが約 10 mb 増える。25 回の再生成で約 250mb になり、ワーカープロセスを
  // 再起動して回収するまでに増えるメモリーの量としては、
  // 許容できると思われる。
  if (changeCount > 25) {
    const oldWorker = worker
    const newWorker = startWorker()
    worker = newWorker
    oldWorker.end()
    changeCount = 0
  } else {
    worker.all.deleteModuleCache(htmlComponentRendererPath)
    delete require.cache[require.resolve(htmlComponentRendererPath)]
  }
}

const searchFileForString = (
  substring: string,
  filePath: string
): Promise<boolean> =>
  new Promise(resolve => {
    const escapedSubString = substring.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)

    // チャンクが（notVisited ではなく）newComponents 配列にあるかを調べる。
    const chunkRegex = RegExp(
      `exports.ssrComponents.*${escapedSubString}.*}`,
      `gs`
    )
    const stream = fs.createReadStream(filePath)
    let found = false
    stream.on(`data`, function (d) {
      if (chunkRegex.test(d.toString())) {
        found = true
        stream.close()
        resolve(found)
      }
    })
    stream.on(`error`, function () {
      resolve(found)
    })
    stream.on(`close`, function () {
      resolve(found)
    })
  })

const ensurePathComponentInSSRBundle = async (
  page: IGatsbyPage,
  directory: string,
  allowTimedFallback: boolean
): Promise<boolean> => {
  // これは起こらないはずである。
  if (!page) {
    report.panic(`page not found`, page)
  }

  // 次に、正しいパスに書き込まれているかを確認する
  const htmlComponentRendererPath = nodePath.join(
    directory,
    ROUTES_DIRECTORY,
    `render-page.js`
  )

  // この検索には 1〜10ms かかる
  // これを行うのは競合状態がありうるためである。2 つのページが
  // 同時にリクエストされると、最初のページが完了した時点で、両方に render-page.js が
  // 変更されたと通知される。その場合、2 番目のページのコンポーネントは
  // render に含まれておらず、その SSR は失敗する。
  let found = await searchFileForString(
    page.componentChunkName,
    htmlComponentRendererPath
  )

  if (!found) {
    await new Promise<void>(resolve => {
      let readAttempts = 0
      const searchForStringInterval = setInterval(async () => {
        readAttempts += 1
        found = await searchFileForString(
          page.componentChunkName,
          htmlComponentRendererPath
        )
        if (found || (allowTimedFallback && readAttempts > 5)) {
          clearInterval(searchForStringInterval)
          resolve()
        }
      }, 300)
    })
  }

  return found
}

interface IRenderDevHtmlProps {
  path: string
  page?: IGatsbyPage
  skipSsr?: boolean
  store: GatsbyReduxStore
  error?: IErrorRenderMeta
  htmlComponentRendererPath: string
  directory: string
  req: Request
  allowTimedFallback: boolean
}

export const renderDevHTML = ({
  path,
  page,
  skipSsr = false,
  store,
  error = undefined,
  htmlComponentRendererPath,
  allowTimedFallback,
  directory,
  req,
}: IRenderDevHtmlProps): Promise<{ html: string; serverData?: IServerData }> =>
  // eslint-disable-next-line no-async-promise-executor
  new Promise(async (resolve, reject) => {
    startListener()
    let pageObj
    if (!page) {
      pageObj = findPageByPath(store.getState(), path)
    } else {
      pageObj = page
    }

    let isClientOnlyPage = false
    if (pageObj.matchPath) {
      isClientOnlyPage = true
    }

    const { actions } = require(`../../redux/actions`)
    const { createServerVisitedPage } = actions
    // このページがリクエストされたことを記録する。これをきっかけに、そのページ
    // コンポーネントが ssr バンドルに追加される（まだ追加されていない場合）
    store.dispatch(createServerVisitedPage(pageObj.componentChunkName))

    // クエリが実行され、書き出されていることを確認する。
    try {
      await getPageDataExperimental(
        pageObj.path,
        // 15000 はこの関数のデフォルトのタイムアウトである。待つことが許される場合のために
        // ここではこの値を残し、SSR が確実に行われるようにしたい場合は、
        // ありえないほど大きな値を設定する
        allowTimedFallback ? 15000 : Number.MAX_SAFE_INTEGER
      )
    } catch {
      // ページを取得できない場合は、おそらく最近削除されたので、
      // 404 ページを返すだけにする。
      return reject(`404 page`)
    }

    // webpack のウォッチャーを再開し、必要なコンパイルが行われるのを待つ。
    // ユーザーは SSR 自体を特に気にしていないかもしれないので、1.5 秒でタイムアウトする。
    //
    // 通常の開発中に webpack の余計な動作が起きないように、一時停止と再開をしている。
    const { recompileAndResumeWatching, needToRecompileSSRBundle } =
      getDevSSRWebpack()

    let stopWatching: (() => void) | undefined = undefined
    if (recompileAndResumeWatching && needToRecompileSSRBundle) {
      stopWatching = await recompileAndResumeWatching(allowTimedFallback)
    }

    // html-renderer がページコンポーネントを反映して更新されるのを待つ。
    // webpack はまだ監視モードなので、必要なものをすべて再コンパイルし終えて
    // いなくても（webpack の中でデバウンスが行われている）、バンドルを
    // 更新する可能性があることに注意（コンポーネントがバンドルに含まれることを
    // 確認した後に `stopWatching()` を呼ぶまで）
    const found = await ensurePathComponentInSSRBundle(
      pageObj,
      directory,
      allowTimedFallback
    )

    if (stopWatching) {
      stopWatching()
    }

    // ページが見つからない場合は、isClientOnlyPage を強制的に設定する。
    // これにより、body のレンダリングをスキップし（シェルだけを配信する）、
    // ページはクライアントで通常どおりレンダリングされる。
    //
    // これは、ページコンポーネントを初めてレンダリングしようとして、
    // そのページコンポーネントのバンドルに時間がかかっている場合にだけ起きる。
    if (!found) {
      isClientOnlyPage = true
    }

    // ユーザーがクエリ文字列 `skip-ssr` を付けた場合は、常に空のシェルだけをレンダリングする。
    if (skipSsr) {
      isClientOnlyPage = true
    }

    let serverData: IServerData | undefined = undefined
    const pageMode = getPageMode(pageObj)
    if (pageMode === `SSR` && found && !isClientOnlyPage) {
      const renderer = require(htmlComponentRendererPath)
      const componentInstance = await renderer.getPageChunk(pageObj)

      try {
        serverData = await getServerData(
          req,
          pageObj,
          req.path,
          componentInstance
        )
      } catch (err) {
        return reject(
          parseError({
            err,
            directory,
            componentPath: pageObj.component,
            htmlComponentRendererPath,
          })
        )
      }
    }

    const publicDir = nodePath.join(directory, `public`)

    try {
      const htmlString = await worker.single.renderHTML({
        path,
        componentPath: pageObj.component,
        htmlComponentRendererPath,
        directory,
        publicDir,
        isClientOnlyPage,
        error,
        serverData: serverData?.props,
      })
      return resolve({ html: htmlString, serverData })
    } catch (error) {
      return reject(error)
    }
  })
