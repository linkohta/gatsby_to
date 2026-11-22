import { formatLogMessage } from "~/utils/format-log-message"
import { getStore, withPluginKey, snapshotContext } from "~/store"
import { getGatsbyApi } from "~/utils/get-gatsby-api"
import { contentPollingQuery } from "../../../utils/graphql-queries"
import fetchGraphql from "../../../utils/fetch-graphql"
import { LAST_COMPLETED_SOURCE_TIME } from "../../../constants"

/**
 * この関数は、Gatsby が処理できる WPGatsby のアクションが少なくとも 1 つあるかを確認する
 * あれば refresh の webhook を呼び出し、スキーマのカスタマイズとノードのソーシングをもう一度実行させる。
 */
const checkForNodeUpdates = async ({ cache, emitter }) => {
  // 新しいアクションがあるかどうかが分かるまで、ポーリングを一時停止する
  // なければ下で再開し、あれば sourceNodes の最後
  // （下の WEBHOOK_RECEIVED がきっかけになる）で再開する
  getStore().dispatch.develop.pauseRefreshPolling()

  // 最後にソーシングした時刻を取得する
  const lastCompletedSourceTime = await cache.get(
    withPluginKey(LAST_COMPLETED_SOURCE_TIME)
  )
  const since = lastCompletedSourceTime - 500

  // それ以降に発生したアクションを graphql でリクエストする
  const {
    data: {
      actionMonitorActions: { nodes: newActions },
    },
  } = await fetchGraphql({
    query: contentPollingQuery,
    variables: {
      since,
    },
    // refetcher() で自動的に復旧できるよう、fetch のエラーと graphql のエラーを投げる
    throwGqlErrors: true,
    throwFetchErrors: true,
  })

  if (newActions.length) {
    emitter.emit(`WEBHOOK_RECEIVED`, {
      webhookBody: {
        since,
        refreshing: true,
      },
      pluginName: `gatsby-source-wordpress`,
    })
  } else {
    // 最後にソーシングが完了した時刻を新しく設定し、先へ進む
    await cache.set(withPluginKey(LAST_COMPLETED_SOURCE_TIME), Date.now())
    getStore().dispatch.develop.resumeRefreshPolling()
  }
}

const refetcher = async (
  msRefetchInterval,
  helpers,
  { reconnectionActivity = null, retryCount = 1 } = {}
) => {
  try {
    const { refreshPollingIsPaused } = getStore().getState().develop

    if (!refreshPollingIsPaused) {
      await checkForNodeUpdates(helpers)
    }

    if (reconnectionActivity) {
      reconnectionActivity.end()
      helpers.reporter.success(
        formatLogMessage(
          `Content updates re-connected after ${retryCount} ${
            retryCount === 1 ? `try` : `tries`
          }`
        )
      )

      reconnectionActivity = null
      retryCount = 1
    }
  } catch (e) {
    const { pluginOptions } = getGatsbyApi()
    if (pluginOptions?.debug?.throwRefetchErrors) {
      throw e
    }

    if (!reconnectionActivity) {
      reconnectionActivity = helpers.reporter.activityTimer(
        formatLogMessage(`Content update error: "${e.message}"`)
      )
      reconnectionActivity.start()
      reconnectionActivity.setStatus(`retrying...`)
    } else {
      retryCount++
      reconnectionActivity.setStatus(`retried ${retryCount} times`)
    }

    // リトライ回数 × 5 秒後にリトライする
    const retryTime = retryCount * 5000
    // リトライまでの時間が最大値（60 秒）以上であれば
    // 最大値を使い、そうでなければリトライまでの時間を使う
    const maxWait = 60000
    const waitFor = retryTime >= maxWait ? maxWait : retryTime

    await new Promise(resolve => setTimeout(resolve, waitFor))
  }

  setTimeout(
    () =>
      refetcher(msRefetchInterval, helpers, {
        reconnectionActivity,
        retryCount,
      }),
    msRefetchInterval
  )
}

let startedPolling = false
let firstCompilationDone = false

/**
 * WordPress の最新の変更を取得し続ける処理を開始する
 * データが変わったときに Gatsby のノードを更新できるようにするためである
 */
const startPollingForContentUpdates = helpers => {
  if (
    startedPolling ||
    process.env.WP_DISABLE_POLLING ||
    process.env.ENABLE_GATSBY_REFRESH_ENDPOINT
  ) {
    return
  }

  startedPolling = true

  const { verbose, develop } = getStore().getState().gatsbyApi.pluginOptions
  const restoreContext = snapshotContext()
  const msRefetchInterval = develop.nodeUpdateInterval

  helpers.emitter.on(`COMPILATION_DONE`, () => {
    /**
     * refetcher ヘルパーを開始するのは、最初の COMPILATION_DONE イベントの後の 1 回だけにしたい。
     * このイベントは開発サーバーの準備ができたときに発生する。コードの変更を保存した後にも発生するが、このコードは 1 回だけ実行したい。
     * onCreateDevServer（フックしている node API）は、開発サーバーの準備ができる前に呼ばれる。
     * その時点でロジックを実行すると、開発サーバーの準備ができる前に WEBHOOK_RECEIVED イベントを発生させてしまい、Gatsby がエラーを投げる可能性があるので問題になる。この問題を避けるため、COMPILATION_DONE にフックしている。
     */
    if (!firstCompilationDone) {
      firstCompilationDone = true

      // ターミナルの出力がなめらかになるよう、1 秒待つ
      setTimeout(() => {
        if (verbose) {
          // 理由は分からないが、ここで ALS のコンテキストが失われるので、手動で復元する必要がある
          restoreContext()
          helpers.reporter.log(``)
          helpers.reporter.info(
            formatLogMessage`Watching for WordPress changes`
          )
        }

        refetcher(msRefetchInterval, helpers)
      }, 1000)
    }
  })
}

export { startPollingForContentUpdates }
