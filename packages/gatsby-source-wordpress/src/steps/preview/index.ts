import { getPluginOptions } from "./../../utils/get-gatsby-api"
import { GatsbyHelpers } from "~/utils/gatsby-types"
import path from "path"
import fs from "fs-extra"
import chalk from "chalk"
import urlUtil from "url"
import PQueue from "p-queue"
import { dump } from "dumper.js"
import { actions as gatsbyActions } from "gatsby/dist/redux/actions/public"

import { remoteSchemaSupportsFieldNameOnTypeName } from "~/steps/ingest-remote-schema/introspect-remote-schema"
import { paginatedWpNodeFetch } from "~/steps/source-nodes/fetch-nodes/fetch-nodes-paginated"
import fetchGraphql from "~/utils/fetch-graphql"

import { getStore } from "~/store"

import { fetchAndCreateSingleNode } from "~/steps/source-nodes/update-nodes/wp-actions/update"
import { formatLogMessage } from "~/utils/format-log-message"
import { touchValidNodes } from "../source-nodes/update-nodes/fetch-node-updates"

import { Reporter } from "gatsby/reporter"
import { invokeAndCleanupLeftoverPreviewCallbacks } from "./cleanup"

const inDevelopPreview =
  process.env.NODE_ENV === `development` &&
  !!process.env.ENABLE_GATSBY_REFRESH_ENDPOINT

const inPreviewRunner =
  process.env.RUNNER_TYPE === `PREVIEW` ||
  process.env.RUNNER_TYPE === `INCREMENTAL_PREVIEWS` ||
  !!process.env.IS_GATSBY_PREVIEW

// これが関数になっているのは、コードの多くの箇所がそれを前提にしているからにすぎない。
// 以前は getStore().getState() を呼び出し、何らかの状態を確認してプレビューモードを判定していた
export const inPreviewMode = (): boolean => inDevelopPreview || inPreviewRunner

export type PreviewStatusUnion =
  | `PREVIEW_SUCCESS`
  | `NO_PAGE_CREATED_FOR_PREVIEWED_NODE`
  | `GATSBY_PREVIEW_PROCESS_ERROR`
  | `RECEIVED_PREVIEW_DATA_FROM_WRONG_URL`

export interface IPreviewData {
  previewDatabaseId: number
  userDatabaseId: number
  token: string
  remoteUrl: string
  modified: string
  parentDatabaseId: number
  id: string
  isDraft: boolean
  singleName: string
  since?: number
  refreshing?: boolean
  preview?: boolean
  manifestIds?: Array<string>
}

interface IPageNode {
  path: string
}

let previewQueue: PQueue

const getPreviewQueue = (): PQueue => {
  if (!previewQueue) {
    const { previewRequestConcurrency } =
      getStore().getState().gatsbyApi.pluginOptions.schema

    previewQueue = new PQueue({
      concurrency: previewRequestConcurrency,
      carryoverConcurrencyCount: true,
    })
  }

  return previewQueue
}

// 渡されたプレビュー id のプレビューを、すでに処理中であるかどうかを
// 確認する。
const previewForIdIsAlreadyBeingProcessed = (id: string): boolean => {
  if (!id) {
    return false
  }

  const existingCallbacks =
    getStore().getState().previewStore.nodePageCreatedCallbacks

  const alreadyProcessingThisPreview = !!existingCallbacks?.[id]

  return alreadyProcessingThisPreview
}

/**
 * 下書きの投稿のプレビューでは、WPGatsby が page-data.json を読もうとしているあいだに、
 * gatsby develop が 404 エラーを大量に出す
 * そこで、page-data.json が存在しなければダミーを書き出す。
 * こうすれば 404 は出なくなり、Gatsby は必要になったときにダミーのファイルを
 * 上書きする。
 */
const writeDummyPageDataJsonIfNeeded = async ({
  previewData,
  pageNode,
}: {
  previewData: IPreviewData
  pageNode: IPageNode
}): Promise<void> => {
  if (!previewData.isDraft) {
    return
  }

  const pageDataDirectory = path.join(
    process.cwd(),
    `public/page-data`,
    pageNode.path
  )

  await fs.ensureDir(pageDataDirectory)

  const pageDataPath = path.join(pageDataDirectory, `page-data.json`)

  const pageDataExists = await fs.pathExists(pageDataPath)

  if (!pageDataExists) {
    await fs.writeJSON(pageDataPath, {
      isDraft: previewData.isDraft,
    })
  }
}

interface IOnPreviewStatusInput {
  status: PreviewStatusUnion
  context?: string
  nodeId?: string
  passedNode?: {
    modified?: string
    databaseId: number
  }
  pageNode?: IPageNode
  graphqlEndpoint?: string
  error?: Error
}

const createPreviewStatusCallback =
  ({
    previewData,
    reporter,
  }: {
    previewData: IPreviewData
    reporter: Reporter
  }) =>
  async ({
    passedNode,
    pageNode,
    context,
    status,
    graphqlEndpoint,
    error,
  }: IOnPreviewStatusInput): Promise<void> => {
    if (status === `PREVIEW_SUCCESS`) {
      // まだ存在しないかもしれない page-data.json を WPGatsby が読もうとしたときに
      // Gatsby が 404 エラーを出さないよう、ダミーの page-data.json を
      // 書き出す必要があるかもしれない
      await writeDummyPageDataJsonIfNeeded({ previewData, pageNode })
    }

    const statusContext = error?.message
      ? `${context}\n\n${error.message}`
      : context

    const { data } = await fetchGraphql({
      url: graphqlEndpoint,
      query: /* GraphQL */ `
        mutation MUTATE_PREVIEW_NODE(
          $input: WpGatsbyRemotePreviewStatusInput!
        ) {
          wpGatsbyRemotePreviewStatus(input: $input) {
            success
          }
        }
      `,
      variables: {
        input: {
          clientMutationId: `sendPreviewStatus`,
          modified: passedNode?.modified,
          pagePath: pageNode?.path,
          parentDatabaseId:
            previewData.parentDatabaseId || previewData.previewDatabaseId, // parentDatabaseId が 0 の場合は previewDatabaseId を使いたい
          status,
          statusContext,
        },
      },
      errorContext: `Error occurred while mutating WordPress Preview node meta.`,
      forceReportCriticalErrors: true,
      headers: {
        WPGatsbyPreview: previewData.token,
        WPGatsbyPreviewUser: previewData.userDatabaseId,
      },
    })

    if (data?.wpGatsbyRemotePreviewStatus?.success) {
      reporter.log(
        formatLogMessage(
          `Successfully sent Preview status back to WordPress post ${previewData.id} during ${context}`
        )
      )
    } else {
      reporter.log(
        formatLogMessage(
          `failed to mutate WordPress post ${previewData.id} during Preview ${context}.\nCheck your WP server logs for more information.`
        )
      )
    }
  }

/**
 * これは、ActionMonitor.previewData オブジェクトの結果と JWT トークンを渡されて呼び出される
 * 1 件のプレビューをソーシングし、プレビューの状態を WPGatsby へ送り返すために呼び出されるコールバックを作成する。
 * プレビューの状態が Gatsby へ送り返されると、このロジックが処理している
 * プレビューのアクションは WP のインスタンスから削除される。そのため、
 * previewForIdIsAlreadyBeingProcessed を呼び出して、別のプレビューの webhook が
 * このアクションの処理をすでに始めていないかを確認している
 */
export const sourcePreview = async ({
  previewData,
  reporter,
  actions,
}: {
  previewData: IPreviewData
  reporter: Reporter
  actions: typeof gatsbyActions
}): Promise<void> => {
  if (previewForIdIsAlreadyBeingProcessed(previewData?.id)) {
    return
  }

  const requiredProperties = [
    `previewDatabaseId`,
    `id`,
    `token`,
    `remoteUrl`,
    `parentDatabaseId`,
    `modified`,
    `userDatabaseId`,
  ]

  const missingProperties = requiredProperties.filter(
    property => !(property in previewData)
  )

  if (!previewData || missingProperties.length) {
    reporter.warn(
      formatLogMessage(
        `sourcePreview was called but the required previewData properties weren't provided.`
      )
    )
    reporter.info(
      formatLogMessage(
        `Missing properties: \n${JSON.stringify(missingProperties, null, 2)}`
      )
    )
    reporter.log(
      formatLogMessage(`previewData: \n${JSON.stringify(previewData, null, 2)}`)
    )
    return
  }

  await touchValidNodes()

  const sendPreviewStatus = createPreviewStatusCallback({
    previewData,
    reporter,
  })

  // このコールバックは、このノードのページが作成または更新されたときに呼び出される
  // その後、WPGraphQL にミューテーションを送り、プレビューの準備ができたことを WP に伝える
  getStore().dispatch.previewStore.subscribeToPagesCreatedFromNodeById({
    nodeId: previewData.id,
    modified: previewData.modified,
    sendPreviewStatus,
  })

  const { node } = await fetchAndCreateSingleNode({
    actionType: `PREVIEW`,
    ...previewData,
    previewParentId: previewData.parentDatabaseId,
    isPreview: true,
  })

  if (
    previewData?.manifestIds?.length &&
    `unstable_createNodeManifest` in actions &&
    node
  ) {
    previewData.manifestIds.forEach(manifestId => {
      actions.unstable_createNodeManifest({
        manifestId,
        node,
      })
    })
  }
}

/**
 * これは、WP のプレビューから /__refresh エンドポイントへ POST されたときに呼び出される。
 * 実行されるのはプレビューモード、つまり process.env.ENABLE_GATSBY_REFRESH_ENDPOINT = true のときだけのはずである
 * まず保留中のプレビューのアクションをすべてソーシングし、それぞれについて sourcePreview() を呼び出す。
 */
export const sourcePreviews = async (helpers: GatsbyHelpers): Promise<void> => {
  const { webhookBody, reporter, actions } = helpers
  const {
    debug: { preview: inPreviewDebugModeOption },
    url,
  } = getPluginOptions()

  // WPGatsby のバージョンによっては、すべての webhook で remoteUrl を送るわけではない。
  // すべての webhookBody でこれを確認するとエラーになる
  if (webhookBody.remoteUrl) {
    // プレビューのデータを正しい WP のバックエンドから受け取っているかを確認する
    const { hostname: settingsHostname } = urlUtil.parse(url)
    const { hostname: remoteHostname } = urlUtil.parse(webhookBody.remoteUrl)

    if (settingsHostname !== remoteHostname) {
      const sendPreviewStatus = createPreviewStatusCallback({
        previewData: webhookBody,
        reporter,
      })

      await sendPreviewStatus({
        status: `RECEIVED_PREVIEW_DATA_FROM_WRONG_URL`,
        context: `check that the preview data came from the right URL.`,
        passedNode: {
          modified: webhookBody.modified,
          databaseId: webhookBody.parentDatabaseId,
        },
        graphqlEndpoint: webhookBody.remoteUrl,
      })

      reporter.warn(
        formatLogMessage(
          `Received preview data from a different remote URL than the one specified in plugin options. Preview will not work. Please send preview requests from the WP instance configured in gatsby-config.js.\n\n ${chalk.bold(
            `Remote URL:`
          )} ${webhookBody.remoteUrl}\n ${chalk.bold(
            `Plugin options URL:`
          )} ${url}\n\n`
        )
      )

      return
    }
  }

  const inPreviewDebugMode =
    inPreviewDebugModeOption || process.env.WP_GATSBY_PREVIEW_DEBUG

  if (inPreviewDebugMode) {
    reporter.info(`Sourcing previews for the following webhook:`)
    dump(webhookBody)
  }

  const wpGatsbyPreviewNodeManifestsAreSupported =
    await remoteSchemaSupportsFieldNameOnTypeName({
      typeName: `GatsbyPreviewData`,
      fieldName: `manifestIds`,
    })

  const previewActions = await paginatedWpNodeFetch({
    contentTypePlural: `actionMonitorActions`,
    nodeTypeName: `ActionMonitor`,
    headers: {
      WPGatsbyPreview: webhookBody.token,
      WPGatsbyPreviewUser: webhookBody.userDatabaseId,
    },
    helpers,
    query: /* GraphQL */ `
      query PREVIEW_ACTIONS($after: String) {
        actionMonitorActions(
          where: {
            previewStream: true
            status: PRIVATE
            orderby: { field: MODIFIED, order: DESC }
            sinceTimestamp: ${
              // 過去 60 分以内に作られたプレビューだけをソーシングする
              // 処理したプレビューのアクションはすべて削除しているので、これはプレビュー間の非常に長いコールドビルドを考慮したものである。
              Date.now() - 1000 * 60 * 60
            }
          }
          first: 100
          after: $after
        ) {
          nodes {
            previewData {
              id
              isDraft
              modified
              parentDatabaseId
              previewDatabaseId
              remoteUrl
              singleName
              userDatabaseId
              ${wpGatsbyPreviewNodeManifestsAreSupported ? `manifestIds` : ``}
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
  })

  if (!previewActions?.length) {
    if (inPreviewDebugMode) {
      reporter.info(
        `Preview for id ${webhookBody?.id} returned no action monitor actions.`
      )
    }
    return
  }

  if (inPreviewDebugMode) {
    reporter.info(
      `Preview for id ${webhookBody?.id} returned the following actions:`
    )
    dump(previewActions)
  }

  const queue = getPreviewQueue()

  for (const { previewData } of previewActions) {
    queue.add(() =>
      sourcePreview({
        previewData: { ...previewData, token: webhookBody.token },
        reporter,
        actions,
      })
    )
  }

  await Promise.all([queue.onEmpty(), queue.onIdle()])

  // ほかで処理しきれなかったものを片付けるため、最後に残りのコールバックを整理する
  await invokeAndCleanupLeftoverPreviewCallbacks({
    status: `GATSBY_PREVIEW_PROCESS_ERROR`,
    context: `Starting sourcePreviews`,
  })
}
