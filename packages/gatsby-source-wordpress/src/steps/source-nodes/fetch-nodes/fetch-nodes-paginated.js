import fetchGraphql from "~/utils/fetch-graphql"
import { getStore } from "~/store"
import { formatLogMessage } from "../../../utils/format-log-message"

export const normalizeNode = ({ node, nodeTypeName }) => {
  const normalizedNodeTypeName = node.__typename || nodeTypeName
  // @todo node.type はどこかで使われているか
  node.type = normalizedNodeTypeName
  // これは、ノードのインターフェースをコンテンツタイプで絞り込むために使う
  node.nodeType = normalizedNodeTypeName

  return node
}

// これは、コールドビルドで id をすでに見たかどうかを
// 判定するために使う。
// こうしているのは、同じ id のノードを 2 つ作成していないかを検出するためである
// そうなると、Gatsby のノードが WP より少なくなり、ユーザーが混乱する。
const idSet = new Set()
let hasLoggedDuplicateMessage = false

/**
 * paginatedWpNodeFetch
 *
 * リモートのノードを再帰的に取得し、ページ送りする
 */
const paginatedWpNodeFetch = async ({
  contentTypePlural,
  query,
  nodeTypeName,
  helpers,
  throwFetchErrors = false,
  throwGqlErrors = false,
  allContentNodes = [],
  after = null,
  settings = {},
  headers = {},
  ...variables
}) => {
  if (
    !settings.limit &&
    typeof settings.limit === `number` &&
    settings.limit === 0
  ) {
    // プラグインオプションの Type.limit が数値の 0 に設定されている場合は、
    // 何も取得すべきではない
    return []
  }

  if (
    settings.limit &&
    // 上限を超えて取得しようとしている場合
    allContentNodes.length + variables.first > settings.limit
  ) {
    // 残りの数だけ取得する
    variables.first = settings.limit - allContentNodes.length
  }

  // GQL の変数 "first" がプラグインオプションの Type.limit より大きいのは
  // 望ましくない
  if (settings.limit && settings.limit < variables.first) {
    // そのため、上限の数だけ取得する
    variables.first = settings.limit
  }

  const errorContext = `Error occurred while fetching nodes of the "${nodeTypeName}" type.`

  const response = await fetchGraphql({
    query,
    throwFetchErrors,
    throwGqlErrors,
    variables: {
      ...variables,
      after,
    },
    errorContext,
    headers,
  })

  const { data } = response

  if (!data?.[contentTypePlural]?.nodes) {
    return allContentNodes
  }

  let {
    [contentTypePlural]: { nodes, pageInfo },
  } = data

  const { hasNextPage, endCursor } = pageInfo || {}

  // 非公開の投稿が null で返ってくることがある。
  // それは問題になるので、取り除く
  nodes = nodes.filter(Boolean)

  if (nodes && nodes.length) {
    nodes.forEach(node => {
      const existingId = idSet.has(node.id)

      if (
        existingId &&
        // since 変数がある場合は、
        // WPGQL からノードの更新の一覧を取得している
        // その場合は、重複のログ出力を気にする必要はない
        !(`since` in variables)
      ) {
        const existingNode = allContentNodes.find(
          innerNode => innerNode.id === node.id
        )

        if (existingNode) {
          if (!hasLoggedDuplicateMessage) {
            hasLoggedDuplicateMessage = true
            helpers.reporter.warn(
              formatLogMessage(
                `Found a duplicate ID in WordPress - this means you will have fewer nodes in Gatsby than in WordPress. This will need to be resolved in WP by identifying and fixing the underlying bug with your WP plugins or custom code.`
              )
            )
          }

          if (node?.databaseId && node?.uri && existingNode?.uri) {
            helpers.reporter.info(
              formatLogMessage(
                `Node with ID ${node.databaseId}/${node.id} of type ${node.__typename} was fetched multiple times. This is a WPGraphQL bug where pagination returns duplicate nodes.`
              )
            )
          }
        }
      } else {
        idSet.add(node.id)
      }

      node = normalizeNode({ node, nodeTypeName })
      allContentNodes.push(node)
    })

    // MediaItem 型は createMediaItemNode で加算される
    if (nodeTypeName !== `MediaItem`) {
      getStore().dispatch.logger.incrementActivityTimer({
        typeName: nodeTypeName,
        by: nodes.length,
      })
    }
  }

  if (
    hasNextPage &&
    endCursor &&
    (!settings.limit || settings.limit > allContentNodes.length)
  ) {
    return paginatedWpNodeFetch({
      ...variables,
      contentTypePlural,
      nodeTypeName,
      query,
      allContentNodes,
      helpers,
      settings,
      after: endCursor,
      headers,
    })
  } else {
    return allContentNodes
  }
}

export { paginatedWpNodeFetch }
