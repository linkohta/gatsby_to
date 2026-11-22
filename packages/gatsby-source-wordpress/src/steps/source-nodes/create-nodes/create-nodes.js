import PQueue from "p-queue"
import fetchReferencedMediaItemsAndCreateNodes from "../fetch-nodes/fetch-referenced-media-items"
import urlToPath from "~/utils/url-to-path"
import { getStore } from "~/store"
import fetchGraphql from "~/utils/fetch-graphql"
import { usingGatsbyV4OrGreater } from "~/utils/gatsby-version"

import {
  buildTypeName,
  getTypeSettingsByType,
} from "~/steps/create-schema-customization/helpers"
import { processNode } from "./process-node"

// @todo 現在、同時実行数をかなり低く設定している。副作用でリモートサーバーに
// 負荷がかかりすぎるためである。ソースプラグイン全体で 1 つのキューを作り、
// すべてが共有するようにすれば、こうした処理の一部を速くできる
const createNodesQueue = new PQueue({
  concurrency: 2,
})

export const createNodeWithSideEffects =
  ({
    node,
    state,
    wpgqlNodesGroup = null,
    referencedMediaItemNodeIds = new Set(),
    createdNodeIds = [],
    createNodesActivity = null,
    totalSideEffectNodes = null,
    type = null,
  }) =>
  async () => {
    const { wpUrl } = state.remoteSchema
    const { helpers, pluginOptions } = state.gatsbyApi

    const { actions, createContentDigest } = helpers

    if (node.link) {
      // @todo これはまだ必要か。不要だと思うが、念のため確認すること
      // WP のパーマリンクを使って、ノードの pathname を作成する
      node.path = urlToPath(node.link)
    }

    if (wpgqlNodesGroup?.plural !== `mediaItems`) {
      const { processedNode } = await processNode({
        node,
        pluginOptions,
        referencedMediaItemNodeIds,
        wpUrl,
        helpers,
      })

      node = processedNode
    }

    const builtTypename = buildTypeName(
      node.__typename,
      pluginOptions.schema.typePrefix
    )

    let remoteNode = {
      ...node,
      __typename: builtTypename,
      id: node.id,
      parent: null,
      internal: {
        contentDigest: createContentDigest(node),
        type: type || builtTypename,
      },
    }

    const typeSettings = getTypeSettingsByType({
      name: node.type,
    })

    if (typeof typeSettings?.beforeChangeNode === `function`) {
      const { additionalNodeIds, remoteNode: changedRemoteNode } =
        (await typeSettings.beforeChangeNode({
          actionType: `CREATE_ALL`,
          remoteNode,
          actions,
          helpers,
          type: node.type,
          fetchGraphql,
          typeSettings,
          buildTypeName,
          wpStore: getStore(),
        })) || {}

      if (changedRemoteNode) {
        remoteNode = changedRemoteNode
      }

      if (additionalNodeIds?.length && totalSideEffectNodes) {
        additionalNodeIds.forEach(
          id => createdNodeIds.push(id) && totalSideEffectNodes.push(id)
        )
      }

      if (
        totalSideEffectNodes &&
        typeof totalSideEffectNodes?.length === `number` &&
        totalSideEffectNodes.length > 0 &&
        createNodesActivity
      ) {
        createNodesActivity.setStatus(
          `awaiting async side effects - ${totalSideEffectNodes.length} additional nodes fetched`
        )
      }
    }

    await actions.createNode(remoteNode)

    createdNodeIds.push(node.id)
  }

export const createGatsbyNodesFromWPGQLContentNodes = async ({
  wpgqlNodesByContentType,
  createNodesActivity,
}) => {
  const state = getStore().getState()
  const { helpers, pluginOptions } = state.gatsbyApi

  const { reporter } = helpers

  // wp は次のファイル拡張子に対応している
  // jpeg|jpg|png|gif|ico|pdf|doc|docx|ppt|pptx|pps|ppsx|odt|xls|psd|mp3|m4a|ogg|wav|mp4|m4v|mov|wmv|avi|mpg|ogv|3gp|3g2|svg|bmp|tif|tiff|asf|asx|wm|wmx|divx|flv|qt|mpe|webm|mkv|txt|asc|c|cc|h|csv|tsv|ics|rtx|css|htm|html|m4b|ra|ram|mid|midi|wax|mka|rtf|js|swf|class|tar|zip|gz|gzip|rar|7z|exe|pot|wri|xla|xlt|xlw|mdb|mpp|docm|dotx|dotm|xlsm|xlsb|xltx|xltm|xlam|pptm|ppsm|potx|potm|ppam|sldx|sldm|onetoc|onetoc2|onetmp|onepkg|odp|ods|odg|odc|odb|odf|wp|wpd|key|numbers|pages

  // gatsby-image は次のファイルの種類に対応している
  // const imgSrcRemoteFileRegex = /<img.*?src=\\"(.*?jpeg|jpg|png|webp|tif|tiff$)\\"[^>]+>/gim

  getStore().dispatch.logger.createActivityTimer({
    typeName: `MediaItem`,
    pluginOptions,
    reporter,
  })

  const createdNodeIds = []
  const totalSideEffectNodes = []
  const referencedMediaItemNodeIds = new Set()

  for (const wpgqlNodesGroup of wpgqlNodesByContentType) {
    const wpgqlNodes = wpgqlNodesGroup.allNodesOfContentType

    for (const node of wpgqlNodes.values()) {
      createNodesQueue.add(
        createNodeWithSideEffects({
          state,
          node,
          wpgqlNodesGroup,
          referencedMediaItemNodeIds,
          createdNodeIds,
          createNodesActivity,
          totalSideEffectNodes,
        })
      )
    }
  }

  await createNodesQueue.onIdle()

  const referencedMediaItemNodeIdsArray = [...referencedMediaItemNodeIds]

  /**
   * メディアアイテムを除外していない場合、または（Gatsby v4 より前で）メディアアイテムを遅延取得している場合は、ここでメディアアイテムのノードを先に取得する必要がある
   */
  if (
    !pluginOptions.type.MediaItem.exclude &&
    (!pluginOptions.type.MediaItem.lazyNodes || usingGatsbyV4OrGreater) &&
    referencedMediaItemNodeIdsArray.length
  ) {
    await fetchReferencedMediaItemsAndCreateNodes({
      referencedMediaItemNodeIds: referencedMediaItemNodeIdsArray,
    })

    getStore().dispatch.logger.stopActivityTimer({
      typeName: `MediaItem`,
    })

    return [...createdNodeIds, ...referencedMediaItemNodeIdsArray]
  }

  getStore().dispatch.logger.stopActivityTimer({
    typeName: `MediaItem`,
  })

  return createdNodeIds
}
