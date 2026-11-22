import { runSteps } from "~/utils/run-steps"
import { formatLogMessage } from "~/utils/format-log-message"

import { checkIfSchemaHasChanged } from "./diff-schemas"
import { introspectAndStoreRemoteSchema } from "./introspect-remote-schema"
import { identifyAndStoreIngestableFieldsAndTypes } from "./identify-and-store-ingestable-types"
import { buildNonNodeQueries } from "./build-and-store-ingestible-root-field-non-node-queries"
import { buildNodeQueries } from "./build-queries-from-introspection/build-node-queries"
import { cacheFetchedTypes } from "./cache-fetched-types"
import { writeQueriesToDisk } from "./write-queries-to-disk"
import { withPluginKey } from "~/store"
/**
 * この関数は、スキーマのカスタマイズ中に呼ばれる。
 * リモートの WPGraphQL スキーマを取り込んでキャッシュし、
 * クエリを組み立てて、後でスキーマのカスタマイズに使う
 * 変換済みのオブジェクトを保存する。
 *
 * この関数は、すべての PQR ワーカーで実行しなければならない。
 */
const ingestRemoteSchema = async (helpers, pluginOptions) => {
  if (process.env.NODE_ENV === `development`) {
    // このコードブロックを本番で実行すると、PQR では問題になる
    // この関数はワーカーごとに 1 回実行され、それぞれで結果が必要になるためである
    // ほとんどのワーカーでは、ここでキャッシュを確認した時点で早期に return する
    // PQR は開発時には動かず、このコードブロックは開発時専用のものだったので、
    // この if 文で包んでも問題ないはずである
    const schemaTimeKey = withPluginKey(`lastIngestRemoteSchemaTime`)
    const lastIngestRemoteSchemaTime = await helpers.cache.get(schemaTimeKey)

    const ingestedSchemaInLastTenSeconds =
      Date.now() - lastIngestRemoteSchemaTime <= 10000

    if (lastIngestRemoteSchemaTime && ingestedSchemaInLastTenSeconds) {
      // これを実行できるのは 10 秒に 1 回だけにする
      // 多数の webhook を一度に受け取ったときの空回りを防ぐためである
      return
    }

    await helpers.cache.set(schemaTimeKey, Date.now())
  }

  const activity = helpers.reporter.activityTimer(
    formatLogMessage(`ingest WPGraphQL schema`)
  )

  activity.start()

  try {
    await runSteps(
      [
        checkIfSchemaHasChanged,
        introspectAndStoreRemoteSchema,
        identifyAndStoreIngestableFieldsAndTypes,
        [buildNodeQueries, buildNonNodeQueries],
        [cacheFetchedTypes, writeQueriesToDisk],
      ],
      helpers,
      pluginOptions
    )
  } catch (e) {
    activity.panic(e)
  } finally {
    activity.end()
  }
}

export { ingestRemoteSchema }
