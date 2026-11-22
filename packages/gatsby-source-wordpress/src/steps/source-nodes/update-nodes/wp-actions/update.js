import fetchGraphql from "~/utils/fetch-graphql"
import { getStore } from "~/store"
import { formatLogMessage } from "~/utils/format-log-message"
import chalk from "chalk"
import { getQueryInfoBySingleFieldName } from "../../helpers"
import { getGatsbyApi } from "~/utils/get-gatsby-api"
import { CREATED_NODE_IDS } from "~/constants"
import fetchReferencedMediaItemsAndCreateNodes, {
  addImageCDNFieldsToNode,
} from "../../fetch-nodes/fetch-referenced-media-items"

import { dump } from "dumper.js"
import { atob } from "atob"
import { camelCase } from "lodash"

import {
  buildTypeName,
  getTypeSettingsByType,
} from "~/steps/create-schema-customization/helpers"
import { processNode } from "~/steps/source-nodes/create-nodes/process-node"
import { getPersistentCache, setPersistentCache } from "~/utils/cache"
import { needToTouchNodes } from "../../../../utils/gatsby-features"

export const fetchAndCreateSingleNode = async ({
  singleName,
  id,
  actionType,
  cachedNodeIds = [],
  token = null,
  isPreview = false,
  isDraft = false,
  userDatabaseId = null,
}) => {
  function getNodeQuery() {
    const { nodeQuery, previewQuery } =
      getQueryInfoBySingleFieldName(singleName) || {}

    // プレビューの場合は、プレビュー用のクエリを使う
    // プレビューであっても、最初の空のノードの場合は、
    // 通常のノードのクエリを使う。プレビュー用のクエリは
    // 何も返さないためである
    const query = isPreview && !isDraft ? previewQuery : nodeQuery

    return query
  }

  const query = getNodeQuery()

  const {
    helpers: { reporter, getNode },
    pluginOptions,
  } = getGatsbyApi()

  if (!query) {
    reporter.info(
      formatLogMessage(
        `A ${singleName} was updated, but no query was found for this node type. This node type is either excluded in plugin options or this is a bug.`
      )
    )
    return { node: null }
  }

  const headers =
    token && userDatabaseId
      ? {
          WPGatsbyPreview: token,
          WPGatsbyPreviewUser: userDatabaseId,
        }
      : {}

  const { data } = await fetchGraphql({
    headers,
    query,
    variables: {
      id,
    },
    errorContext: `Error occurred while updating a single "${singleName}" node.`,
  })

  let remoteNode = data[singleName] || data[camelCase(singleName)]

  if (!data || !remoteNode) {
    reporter.warn(
      formatLogMessage(
        `${id} ${singleName} was updated, but no data was returned for this node.`
      )
    )

    reporter.info({
      singleName,
      id,
      actionType,
      cachedNodeIds,
      token,
      isPreview,
      userDatabaseId,
    })

    return { node: null }
  }

  remoteNode.uri = normalizeUri({
    uri: remoteNode.uri,
    singleName,
    id,
  })

  if (isPreview && `slug` in remoteNode && !remoteNode.slug) {
    // プレビューのノードにはスラッグがないことがある。しかし、スラッグを使ってページの URL を組み立てるユーザーもいる。そのため、スラッグに何らかの値が入るようにすべきである。
    remoteNode.slug = id
  }

  if (isPreview) {
    const existingNode = getNode(id)

    /**
     * プレビューでは、あるノードタイプのリビジョンが、不必要に更新されるデータを持つことがある
     * このコードブロックはそれを修正する。その結果、Gatsby で無効化されるクエリが
     * 少なくなる。たとえば、date フィールドを使って最新の公開済み投稿を取得するクエリは本来変化しないはずだが、プレビューのたびに、プレビュー対象のノードの date フィールドが更新される（リビジョンが新しい日付を持つため）。そこで、次のフィールドが変わらないようにすれば、この問題は小さくなる。
     */
    if (existingNode) {
      remoteNode = {
        ...remoteNode,
        databaseId: existingNode.databaseId,
        date: existingNode.date,
        dateGmt: existingNode.dateGmt,
        slug: existingNode.slug,
        guid: existingNode.guid,
        id: existingNode.id,
        link: existingNode.link,
        uri: existingNode.uri,
        status: existingNode.status,
      }
    }
  }

  data[singleName] = remoteNode

  const { additionalNodeIds, node } = await createSingleNode({
    singleName,
    id,
    actionType,
    data,
    cachedNodeIds,
  })

  if (isPreview) {
    reporter.info(
      formatLogMessage(`Preview for ${singleName} ${node.id} was updated.`)
    )

    if (pluginOptions.debug.preview) {
      reporter.info(formatLogMessage(`Raw remote node data:`))
      dump(data)
    }
  }

  return { node, additionalNodeIds }
}

export const createSingleNode = async ({
  singleName,
  id,
  actionType,
  data,
  cachedNodeIds,
}) => {
  const state = getStore().getState()
  const { helpers, pluginOptions } = state.gatsbyApi
  const { wpUrl } = state.remoteSchema

  const { typeInfo } = getQueryInfoBySingleFieldName(singleName)

  if (!cachedNodeIds && needToTouchNodes) {
    cachedNodeIds = await getPersistentCache({ key: CREATED_NODE_IDS })
  }

  const updatedNodeContent = {
    ...data[singleName],
    nodeType: typeInfo.nodesTypeName,
    type: typeInfo.nodesTypeName,
  }

  const { processedNode, nodeMediaItemIdReferences } = await processNode({
    node: updatedNodeContent,
    pluginOptions,
    wpUrl,
    helpers,
  })

  await fetchReferencedMediaItemsAndCreateNodes({
    referencedMediaItemNodeIds: nodeMediaItemIdReferences,
  })

  const { actions } = helpers

  const { createContentDigest } = helpers

  const builtTypename = buildTypeName(typeInfo.nodesTypeName)

  let remoteNode = addImageCDNFieldsToNode(
    {
      ...processedNode,
      __typename: builtTypename,
      id: id,
      parent: null,
      internal: {
        contentDigest: createContentDigest(updatedNodeContent),
        type: builtTypename,
      },
    },
    pluginOptions
  )

  const typeSettings = getTypeSettingsByType({
    name: typeInfo.nodesTypeName,
  })

  let additionalNodeIds = nodeMediaItemIdReferences || []
  let cancelUpdate

  if (
    typeSettings.beforeChangeNode &&
    typeof typeSettings.beforeChangeNode === `function`
  ) {
    const {
      additionalNodeIds: receivedAdditionalNodeIds,
      remoteNode: receivedRemoteNode,
      cancelUpdate: receivedCancelUpdate,
    } = (await typeSettings.beforeChangeNode({
      actionType: actionType,
      remoteNode,
      actions,
      helpers,
      fetchGraphql,
      typeSettings,
      buildTypeName,
      type: typeInfo.nodesTypeName,
      wpStore: getStore(),
    })) || {}

    additionalNodeIds = [
      ...additionalNodeIds,
      ...(receivedAdditionalNodeIds || []),
    ]

    cancelUpdate = receivedCancelUpdate

    if (receivedRemoteNode) {
      remoteNode = receivedRemoteNode
    }
  }

  if (cancelUpdate) {
    return {
      additionalNodeIds,
      remoteNode: null,
    }
  }

  if (remoteNode) {
    actions.createNode(remoteNode)
  }

  if (remoteNode && needToTouchNodes) {
    cachedNodeIds.push(remoteNode.id)
    additionalNodeIds?.forEach(id => cachedNodeIds.push(id))

    await setPersistentCache({ key: CREATED_NODE_IDS, value: cachedNodeIds })
  }

  return { additionalNodeIds, node: remoteNode }
}

const wpActionUPDATE = async ({ helpers, wpAction }) => {
  const reportUpdate = ({ setAction } = {}) => {
    const actionType = setAction || wpAction.actionType

    reporter.log(``)
    reporter.info(
      formatLogMessage(
        `${chalk.bold(
          `${actionType.toLowerCase()} ${wpAction.referencedNodeSingularName}`
        )} ${wpAction.title} (#${wpAction.referencedNodeID})`
      )
    )
    reporter.log(``)
  }

  const { reporter, actions } = helpers

  const cachedNodeIds = await getPersistentCache({ key: CREATED_NODE_IDS })

  const state = getStore().getState()
  const {
    gatsbyApi: {
      pluginOptions: { verbose },
      helpers: { getNode },
    },
  } = state

  const nodeId = wpAction.referencedNodeGlobalRelayID

  const existingNode = await getNode(nodeId)

  if (wpAction.referencedNodeStatus !== `publish`) {
    if (needToTouchNodes) {
      // 投稿のステータスが publish でなくなった場合は、ノードを削除する必要がある
      // キャッシュしたノードから取り除けば、Gatsby がガベージコレクションする
      const validNodeIds = cachedNodeIds.filter(cachedId => cachedId !== nodeId)

      await setPersistentCache({ key: CREATED_NODE_IDS, value: validNodeIds })
    }

    if (existingNode) {
      // ここで touchNode を呼び出すことで、削除の前に owners が確実に設定される。
      // 場合によっては、先にノードを touch せずに deleteNode を呼び出すとエラーになる。これは Gatsby のバグですでに修正されているが、バグが残っている以前のバージョンとの後方互換性のために、このコードを残している。
      // TODO 次のメジャーバージョンで削除する
      await actions.touchNode(existingNode)
      await actions.deleteNode(existingNode)
      reportUpdate({ setAction: `DELETE` })
    }

    return
  }

  const { node } = await fetchAndCreateSingleNode({
    id: nodeId,
    actionType: wpAction.actionType,
    singleName: wpAction.referencedNodeSingularName,
    cachedNodeIds,
  })

  if (node) {
    reportUpdate()

    if (verbose) {
      const nodeEntries = existingNode ? Object.entries(existingNode) : null

      if (nodeEntries?.length) {
        const loggableEntries = nodeEntries.filter(
          ([key]) => !key.includes(`modifiedGmt`) && key !== `modified`
        )

        for (const [key, value] of loggableEntries) {
          if (!node || !node[key] || !value) {
            return
          }

          if (
            // このフィールドの値が変わっていれば、ログに出力する
            typeof node[key] === `string` &&
            value !== node[key]
          ) {
            reporter.log(``)
            reporter.info(chalk.bold(`${key} changed`))

            if (value.length < 250 && node[key].length < 250) {
              reporter.log(``)
              reporter.log(`${chalk.italic.bold(`    from`)}`)
              reporter.log(`      ${value}`)
              reporter.log(chalk.italic.bold(`    to`))
              reporter.log(`      ${node[key]}`)
              reporter.log(``)
            }
          }
        }

        reporter.log(``)
      }
    }
  }

  // return cachedNodeIds
}

const getDbIdFromRelayId = relayId => atob(relayId).split(`:`).reverse()[0]

const normalizeUri = ({ uri, id, singleName }) => {
  // プレビュー用のクエリパラメーターは Gatsby では意味がないので取り除く
  uri = uri?.replace(`preview=true`, ``)

  // プレビューの文字列を取り除いた結果、末尾にこれらの文字の
  // どちらかが残った場合は、切り落とす
  if (uri?.endsWith(`?`) || uri?.endsWith(`&`)) {
    uri = uri.slice(0, -1)
  }

  // これが下書きの URL の場合、たとえば
  // /?p=543534、/?page=4324、/?something=yep&page=543543、/?p=4534&what=yes のような形になる
  // その場合は、Gatsby が扱える適切なパスを作成する
  // /post_graphql_name/post_db_id/
  // この状況に対応するため、同じロジックが WP 側の
  // プレビューテンプレートにもある。
  if (uri?.startsWith(`/?`)) {
    const dbId = getDbIdFromRelayId(id)

    return `/generated-preview-path/${singleName}/${dbId}/`
  }

  return uri
}

export default wpActionUPDATE
