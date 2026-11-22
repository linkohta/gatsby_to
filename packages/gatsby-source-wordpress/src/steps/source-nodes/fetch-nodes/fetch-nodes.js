import { createGatsbyNodesFromWPGQLContentNodes } from "../create-nodes/create-nodes"
import { paginatedWpNodeFetch } from "./fetch-nodes-paginated"
import { formatLogMessage } from "~/utils/format-log-message"
import { CREATED_NODE_IDS } from "~/constants"
import { usingGatsbyV4OrGreater } from "~/utils/gatsby-version"

import { getStore } from "~/store"
import { getGatsbyApi, getPluginOptions } from "~/utils/get-gatsby-api"
import chunk from "lodash/chunk"

import {
  getHardCachedNodes,
  restoreHardCachedNodes,
  setHardCachedNodes,
  setPersistentCache,
} from "~/utils/cache"
import { buildTypeName } from "../../create-schema-customization/helpers"
import { needToTouchNodes } from "../../../utils/gatsby-features"

/**
 * fetchWPGQLContentNodes
 *
 * 進捗を報告しながら、リモートのノードを投稿タイプごとに取得してページ送りする
 */
export const fetchWPGQLContentNodes = async ({ queryInfo }) => {
  const { pluginOptions, helpers } = getStore().getState().gatsbyApi
  const { reporter } = helpers
  const {
    url,
    schema: { perPage },
  } = pluginOptions

  const { nodeListQueries, typeInfo, settings } = queryInfo

  const typeName = typeInfo.nodesTypeName

  getStore().dispatch.logger.createActivityTimer({
    typeName,
    pluginOptions,
    reporter,
  })

  let allNodesOfContentType = []

  // 通常ここにあるクエリは 1 つだけだが、settings.nodeListQueries の API で追加できる
  for (const nodeListQuery of nodeListQueries) {
    const contentNodes = await paginatedWpNodeFetch({
      first: perPage,
      after: null,
      contentTypePlural: typeInfo.pluralName,
      nodeTypeName: typeInfo.nodesTypeName,
      query: nodeListQuery,
      url,
      settings,
      helpers,
    })

    allNodesOfContentType = [...allNodesOfContentType, ...contentNodes]
  }

  getStore().dispatch.logger.stopActivityTimer({ typeName })

  if (allNodesOfContentType && allNodesOfContentType.length) {
    return {
      singular: queryInfo.typeInfo.singularName,
      plural: queryInfo.typeInfo.pluralName,
      allNodesOfContentType,
    }
  }

  return false
}

/**
 * getContentTypeQueryInfos
 *
 * クエリ情報（型情報と GQL のクエリ文字列）を、プラグインオプションで
 * 除外された型を取り除いたうえで返す
 *
 * @returns {Array} 型情報と GQL のクエリ文字列
 */
export const getContentTypeQueryInfos = () => {
  const { nodeQueries } = getStore().getState().remoteSchema
  const queryInfos = Object.values(nodeQueries).filter(
    ({ settings }) => !settings.exclude
  )
  return queryInfos
}

let cachedGatsbyNodeTypeNames = null

export const getGatsbyNodeTypeNames = () => {
  if (cachedGatsbyNodeTypeNames) {
    return cachedGatsbyNodeTypeNames
  }

  const { typeMap } = getStore().getState().remoteSchema

  const queryableTypenames = getContentTypeQueryInfos().map(
    query => query.typeInfo.nodesTypeName
  )

  const implementingNodeTypes = queryableTypenames.reduce(
    (accumulator, typename) => {
      const type = typeMap.get(typename)

      if (type.possibleTypes?.length) {
        accumulator = [
          ...accumulator,
          ...type.possibleTypes.map(({ name }) => name),
        ]
      }

      return accumulator
    },
    []
  )

  const allTypeNames = [
    ...new Set([...queryableTypenames, ...implementingNodeTypes]),
  ]

  const allBuiltTypeNames = allTypeNames.map(typename =>
    buildTypeName(typename)
  )

  const typeNameList = [...allTypeNames, ...allBuiltTypeNames]

  if (typeNameList.length) {
    cachedGatsbyNodeTypeNames = typeNameList
  }

  return typeNameList
}

/**
 * fetchWPGQLContentNodesByContentType
 *
 * リモートの WPGQL サーバーからノードを取得し、投稿タイプごとにグループ化する
 *
 * @returns {Array}
 */
export const runFnForEachNodeQuery = async fn => {
  const nodeQueries = getContentTypeQueryInfos()

  const chunkSize = getPluginOptions()?.schema?.requestConcurrency || 15
  const chunkedQueries = chunk(nodeQueries, chunkSize)

  for (const queries of chunkedQueries) {
    await Promise.all(
      queries.map(async queryInfo => {
        if (
          // 型の設定で lazyNodes が指定されている場合は、ここでは先に取得しない
          (queryInfo.settings.lazyNodes &&
            // ただし Gatsby v4 以降は別である。4 以降では lazyNodes が使えないためである
            !usingGatsbyV4OrGreater) ||
          // メディアアイテムは参照されているノードだけを取得したいので、ここでは取得しない。
          queryInfo.typeInfo.nodesTypeName === `MediaItem`
        ) {
          return
        }

        await fn({ queryInfo })
      })
    )
  }
}

export const fetchWPGQLContentNodesByContentType = async () => {
  const contentNodeGroups = []

  await runFnForEachNodeQuery(async ({ queryInfo }) => {
    const contentNodeGroup = await fetchWPGQLContentNodes({ queryInfo })

    if (contentNodeGroup) {
      contentNodeGroups.push(contentNodeGroup)
    }
  })

  return contentNodeGroups
}

/**
 * fetchAndCreateAllNodes
 *
 * （onPreBootstrap でイントロスペクションから生成した）クエリ情報を使い、
 * リモートスキーマにあるノードのリストを取得して Gatsby のノードを作成する
 */
export const fetchAndCreateAllNodes = async () => {
  const { helpers } = getGatsbyApi()
  const { reporter } = helpers

  //
  // WPGQL からノードを取得する
  const activity = reporter.activityTimer(formatLogMessage(`fetching nodes`))
  activity.start()

  getStore().subscribe(() => {
    activity.setStatus(`${getStore().getState().logger.entityCount} total`)
  })

  let createdNodeIds

  const hardCachedNodes = await getHardCachedNodes()

  if (!hardCachedNodes) {
    const wpgqlNodesByContentType = await fetchWPGQLContentNodesByContentType()

    const createNodesActivity = reporter.activityTimer(
      formatLogMessage(`creating nodes`)
    )
    createNodesActivity.start()

    //
    // WPGQL のレスポンスから Gatsby のノードを作成する
    createdNodeIds = await createGatsbyNodesFromWPGQLContentNodes({
      wpgqlNodesByContentType,
      createNodesActivity,
    })

    await setHardCachedNodes({ helpers })

    createNodesActivity.end()
    activity.end()
  } else if (hardCachedNodes) {
    createdNodeIds = await restoreHardCachedNodes({
      hardCachedNodes,
    })
  }

  if (needToTouchNodes) {
    // 次回のビルドで touch できるよう、ノードの id を保存する
    // こうすれば、すべてのノードを取得し直さずに済む
    await setPersistentCache({ key: CREATED_NODE_IDS, value: createdNodeIds })
  }
}
