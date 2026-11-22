// @ts-check
import chalk from "chalk"
import { createClient } from "contentful"
import _ from "lodash"
import { formatPluginOptionsForCLI } from "./plugin-options"
import { CODES } from "./report"

/**
 * ユーザーに分かりやすいエラーメッセージを生成する。
 *
 * Contentful の API には独自のエラーメッセージの構造があり、内部サーバーエラーか認証エラーかによって変わることがある。
 */
const createContentfulErrorMessage = e => {
  // axios のエラーメッセージを処理する
  if (e.isAxiosError) {
    const axiosErrorMessage = [e.code, e.status]
    const axiosErrorDetails = []

    if (e.response) {
      axiosErrorMessage.push(e.response.status)

      // Contentful API のエラーデータを解析する
      if (e.response?.data) {
        axiosErrorMessage.push(e.response.data.sys?.id, e.response.data.message)
      }

      // ヘッダーからリクエスト ID を取得する
      const requestId =
        e.response.headers &&
        typeof e.response.headers === `object` &&
        e.response.headers[`x-contentful-request-id`]

      if (requestId) {
        axiosErrorDetails.push(`Request ID: ${requestId}`)
      }
    }

    if (e.attempts) {
      axiosErrorDetails.push(`Attempts: ${e.attempts}`)
    }

    if (axiosErrorDetails.length) {
      axiosErrorMessage.push(
        `\n\n---\n${axiosErrorDetails.join(`\n\n`)}\n\n---\n`
      )
    }

    return axiosErrorMessage.filter(Boolean).join(` `)
  }

  // axios のエラーでなければ、Contentful SDK のエラーを受け取ったとみなして解析を試みる
  const errorMessage = [e.name]
  const errorDetails = []
  try {
    /**
     * メッセージから、文字列化されたエラーデータを解析する
     * https://github.com/contentful/contentful-sdk-core/blob/4cfcd452ba0752237a26ce6b79d72a50af84d84e/src/error-handler.ts#L71-L75
     *
     * @todo TS で正しく型を付ける
     * type {
     *    status?: number
     *    statusText?: string
     *    requestId?: string
     *    message: string
     *    !details: Record<string, unknown>
     *    !request?: Record<string, unknown>
     *  }
     */
    const errorData = JSON.parse(e.message)
    errorMessage.push(errorData.status && String(errorData.status))
    errorMessage.push(errorData.statusText)
    errorMessage.push(errorData.message)
    if (errorData.requestId) {
      errorDetails.push(`Request ID: ${errorData.requestId}`)
    }
    if (errorData.request) {
      errorDetails.push(
        `Request:\n${JSON.stringify(errorData.request, null, 2)}`
      )
    }
    if (errorData.details && Object.keys(errorData.details).length) {
      errorDetails.push(
        `Details:\n${JSON.stringify(errorData.details, null, 2)}`
      )
    }
  } catch (err) {
    // 解析できない場合は、人が読める文字列だとみなす
    errorMessage.push(e.message)
  }

  if (errorDetails.length) {
    errorMessage.push(`\n\n---\n${errorDetails.join(`\n\n`)}\n\n---\n`)
  }

  return errorMessage.filter(Boolean).join(` `)
}

function createContentfulClientOptions({
  pluginConfig,
  reporter,
  syncProgress = { total: 0, tick: a => a },
}) {
  let syncItemCount = 0

  const contentfulClientOptions = {
    space: pluginConfig.get(`spaceId`),
    accessToken: pluginConfig.get(`accessToken`),
    host: pluginConfig.get(`host`),
    environment: pluginConfig.get(`environment`),
    proxy: pluginConfig.get(`proxy`),
    integration: `gatsby-source-contentful`,
    responseLogger: response => {
      function createMetadataLog(response) {
        if (!response.headers) {
          return null
        }
        return [
          response?.headers[`content-length`] &&
            `size: ${response.headers[`content-length`]}B`,
          response?.headers[`x-contentful-request-id`] &&
            `request id: ${response.headers[`x-contentful-request-id`]}`,
          response?.headers[`x-cache`] &&
            `cache: ${response.headers[`x-cache`]}`,
        ]
          .filter(Boolean)
          .join(` `)
      }

      // 同期の進捗
      if (
        response.config.url === `sync` &&
        !response.isAxiosError &&
        response?.data.items
      ) {
        syncItemCount += response.data.items.length
        syncProgress.total = syncItemCount
        syncProgress.tick(response.data.items.length)
      }

      const metadataLog = createMetadataLog(response)

      reporter.verbose(
        [
          `${response.config.method} /${response.config.url}:`,
          response.status,
          response.statusText,
          metadataLog && `(${metadataLog})`,
        ]
          .filter(Boolean)
          .join(` `)
      )
    },
    // ヘッダーなど、Contentful SDK へのカスタム設定を渡せるようにする
    ...(pluginConfig.get(`contentfulClientConfig`) || {}),
  }

  return contentfulClientOptions
}

function handleContentfulError({
  e,
  reporter,
  contentfulClientOptions,
  pluginConfig,
}) {
  let details
  let errors
  if (e.code === `ENOTFOUND`) {
    details = `You seem to be offline`
  } else if (e.code === `SELF_SIGNED_CERT_IN_CHAIN`) {
    reporter.panic({
      id: CODES.SelfSignedCertificate,
      context: {
        sourceMessage: `We couldn't make a secure connection to your contentful space. Please check if you have any self-signed SSL certificates installed.`,
      },
    })
  } else if (e.responseData) {
    if (
      e.responseData.status === 404 &&
      contentfulClientOptions.environment &&
      contentfulClientOptions.environment !== `master`
    ) {
      // 環境は master にアクセスできる必要がある
      details = `Unable to access your space. Check if ${chalk.yellow(
        `environment`
      )} is correct and your ${chalk.yellow(
        `accessToken`
      )} has access to the ${chalk.yellow(
        contentfulClientOptions.environment
      )} and the ${chalk.yellow(`master`)} environments.`
      errors = {
        accessToken: `Check if setting is correct`,
        environment: `Check if setting is correct`,
      }
    } else if (e.responseData.status === 404) {
      // URL の生成に使う host と space
      details = `Endpoint not found. Check if ${chalk.yellow(
        `host`
      )} and ${chalk.yellow(`spaceId`)} settings are correct`
      errors = {
        host: `Check if setting is correct`,
        spaceId: `Check if setting is correct`,
      }
    } else if (e.responseData.status === 401) {
      // 認可エラー
      details = `Authorization error. Check if ${chalk.yellow(
        `accessToken`
      )} and ${chalk.yellow(`environment`)} are correct`
      errors = {
        accessToken: `Check if setting is correct`,
        environment: `Check if setting is correct`,
      }
    }
  }

  reporter.panic({
    context: {
      sourceMessage: `Accessing your Contentful space failed: ${createContentfulErrorMessage(
        e
      )}

Try setting GATSBY_CONTENTFUL_OFFLINE=true to see if we can serve from cache.
${details ? `\n${details}\n` : ``}
Used options:
${formatPluginOptionsForCLI(pluginConfig.getOriginalPluginOptions(), errors)}`,
    },
  })
}

/**
 * 次のものを取得する:
 * * デフォルトロケールを含むロケール
 * * エントリーとアセット
 * * タグ
 */
export async function fetchContent({ syncToken, pluginConfig, reporter }) {
  // ロケールを取得し、接続を確認する
  const contentfulClientOptions = createContentfulClientOptions({
    pluginConfig,
    reporter,
  })
  const client = createClient(contentfulClientOptions)

  // 同期 API は、すべてのフィールドにロケールを { fieldName:
  // {'locale': value} } の形式で入れるので、スペースとそのデフォルトロケールを取得する必要がある。
  let space
  let locales
  let defaultLocale = `en-US`
  try {
    reporter.verbose(`Fetching default locale`)
    space = await client.getSpace()
    locales = await client.getLocales().then(response => response.items)
    defaultLocale = _.find(locales, { default: true }).code
    reporter.verbose(
      `Default locale is: ${defaultLocale}. There are ${locales.length} locales in total.`
    )
  } catch (e) {
    handleContentfulError({
      e,
      reporter,
      contentfulClientOptions,
      pluginConfig,
    })
  }

  // Contentful CDA の同期 API でエントリーとアセットを取得する
  const pageLimit = pluginConfig.get(`pageLimit`)
  reporter.verbose(`Contentful: Sync ${pageLimit} items per page.`)
  const syncProgress = reporter.createProgress(
    `Contentful: ${syncToken ? `Sync changed items` : `Sync all items`}`,
    pageLimit,
    0
  )
  syncProgress.start()
  const contentfulSyncClientOptions = createContentfulClientOptions({
    pluginConfig,
    reporter,
    syncProgress,
  })
  const syncClient = createClient(
    contentfulSyncClientOptions
  ).withoutLinkResolution

  let currentSyncData
  let currentPageLimit = pageLimit
  let lastCurrentPageLimit
  let syncSuccess = false
  try {
    while (!syncSuccess) {
      try {
        const query = syncToken
          ? { nextSyncToken: syncToken }
          : { initial: true, limit: currentPageLimit }
        currentSyncData = await syncClient.sync(query)
        syncSuccess = true
      } catch (e) {
        // レスポンスのコンテンツ長が Contentful の上限を超える場合は、ページの上限を引き下げる。
        if (
          e.response?.data?.message.includes(`Response size too big`) &&
          currentPageLimit > 1
        ) {
          lastCurrentPageLimit = currentPageLimit
          // ページの上限を、現在の上限の 1/3（任意に決めた値）だけ引き下げ、新しく大きなエントリーが
          // レスポンスサイズの上限を超えずに同期されるようにする
          currentPageLimit = Math.floor((currentPageLimit / 3) * 2) || 1
          reporter.warn(
            [
              `The sync with Contentful failed using pageLimit ${lastCurrentPageLimit} as the reponse size limit of the API is exceeded.`,
              `Retrying sync with pageLimit of ${currentPageLimit}`,
            ].join(`\n\n`)
          )
          continue
        }
        throw e
      }
      if (currentPageLimit !== pageLimit) {
        reporter.warn(
          `We recommend you to set your pageLimit in gatsby-config.js to ${currentPageLimit} to avoid failed synchronizations.`
        )
      }
    }
  } catch (e) {
    reporter.panic({
      id: CODES.SyncError,
      context: {
        sourceMessage: `Fetching contentful data failed: ${createContentfulErrorMessage(
          e
        )}`,
      },
    })
  } finally {
    // Contentful に新しいデータがなかった場合の出力を補正する
    if (
      !currentSyncData?.entries.length &&
      !currentSyncData?.assets.length &&
      !currentSyncData?.deletedEntries.length &&
      !currentSyncData?.deletedAssets.length
    ) {
      syncProgress.tick()
      syncProgress.total = 1
    }

    syncProgress.done()
  }

  // 同期 API はタグに対応していないので、同期ではない API でタグを取得する必要がある。
  let tagItems = []
  if (pluginConfig.get(`enableTags`)) {
    try {
      const tagsResult = await pagedGet(client, `getTags`, pageLimit)
      tagItems = tagsResult.items
      reporter.verbose(`Tags fetched ${tagItems.length}`)
    } catch (e) {
      reporter.panic({
        id: CODES.FetchTags,
        context: {
          sourceMessage: `Error fetching tags: ${createContentfulErrorMessage(
            e
          )}`,
        },
      })
    }
  }

  const result = {
    currentSyncData,
    tagItems,
    defaultLocale,
    locales,
    space,
  }

  return result
}

/**
 * 次のものを取得する:
 * * コンテンツタイプ
 */
export async function fetchContentTypes({ pluginConfig, reporter }) {
  const contentfulClientOptions = createContentfulClientOptions({
    pluginConfig,
    reporter,
  })
  const client = createClient(contentfulClientOptions)
  const pageLimit = pluginConfig.get(`pageLimit`)
  const sourceId = `${pluginConfig.get(`spaceId`)}-${pluginConfig.get(
    `environment`
  )}`
  let contentTypes = null

  try {
    reporter.verbose(`Fetching content types (${sourceId})`)

    // CDA API からコンテンツタイプを取得する
    try {
      contentTypes = await pagedGet(client, `getContentTypes`, pageLimit)
    } catch (e) {
      reporter.panic({
        id: CODES.FetchContentTypes,
        context: {
          sourceMessage: `Error fetching content types: ${createContentfulErrorMessage(
            e
          )}`,
        },
      })
    }
    reporter.verbose(
      `Content types fetched ${contentTypes.items.length} (${sourceId})`
    )

    contentTypes = contentTypes.items
  } catch (e) {
    handleContentfulError(e)
  }

  return contentTypes
}

/**
 * ページネーションのパラメーターに基づいて、既存のエンティティをすべて取得する。
 * 最初の呼び出しには、集約済みのレスポンスがない。以降の呼び出しでは、
 * 新しいレスポンスを元のレスポンスに連結する。
 */
function pagedGet(
  client,
  method,
  pageLimit,
  query = {},
  skip = 0,
  aggregatedResponse = null
) {
  return client[method]({
    ...query,
    skip: skip,
    limit: pageLimit,
    order: `sys.createdAt`,
  }).then(response => {
    if (!aggregatedResponse) {
      aggregatedResponse = response
    } else {
      aggregatedResponse.items = aggregatedResponse.items.concat(response.items)
    }
    if (skip + pageLimit <= response.total) {
      return pagedGet(
        client,
        method,
        pageLimit,
        query,
        skip + pageLimit,
        aggregatedResponse
      )
    }
    return aggregatedResponse
  })
}
