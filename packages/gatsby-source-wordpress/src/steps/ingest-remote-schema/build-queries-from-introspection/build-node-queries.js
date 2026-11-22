import { getStore } from "~/store"
import { getGatsbyApi } from "~/utils/get-gatsby-api"
import generateNodeQueriesFromIngestibleFields from "./generate-queries-from-ingestable-types"
import { getPersistentCache, setPersistentCache } from "~/utils/cache"

/**
 * buildNodeQueries
 *
 * プラグインオプションを使ってリモートの GraphQL ソースをイントロスペクションし、
 * キャッシュの処理を行い、GQL のクエリ文字列と情報を生成する
 *
 * @returns {Object} gql のクエリ文字列を含む GraphQL のクエリ情報
 */
const buildNodeQueries = async () => {
  const { pluginOptions } = getGatsbyApi()

  const QUERY_CACHE_KEY = `${pluginOptions.url}--introspection-node-queries`

  let nodeQueries = await getPersistentCache({ key: QUERY_CACHE_KEY })

  const { schemaWasChanged } = getStore().getState().remoteSchema

  if (schemaWasChanged || !nodeQueries) {
    // イントロスペクションからクエリを再生成する
    nodeQueries = await generateNodeQueriesFromIngestibleFields()

    // そしてキャッシュする
    await setPersistentCache({ key: QUERY_CACHE_KEY, value: nodeQueries })
  }
  // 後で使えるよう、クエリを redux ストアに設定する
  getStore().dispatch.remoteSchema.setState({
    nodeQueries,
  })

  return nodeQueries
}

export { buildNodeQueries }
