// "bootstrap" は最初の import でなければならない。早い段階で設定する必要がある複数のグローバルをセットアップするためである
// 詳しくはそのモジュールを参照
import "./bootstrap"

import { ExecutionResult, Source } from "graphql"
import { uuid } from "gatsby-core-utils"
import { build } from "../index"
import { setupLmdbStore } from "../../datastore/lmdb/lmdb-datastore"
import { store } from "../../redux"
import { actions } from "../../redux/actions"
import reporter from "gatsby-cli/lib/reporter"
import { GraphQLRunner, IQueryOptions } from "../../query/graphql-runner"
import { waitJobsByRequest } from "../../utils/wait-until-jobs-complete"
import { setGatsbyPluginCache } from "../../utils/import-gatsby-plugin"
import apiRunnerNode from "../../utils/api-runner-node"
import type { IGatsbyPage, IGatsbyState } from "../../redux/types"
import { findPageByPath } from "../../utils/find-page-by-path"
import { runWithEngineContext } from "../../utils/engine-context"
import { getDataStore } from "../../datastore"
import {
  gatsbyNodes,
  gatsbyWorkers,
  flattenedPlugins,
  // @ts-ignore
} from ".cache/query-engine-plugins"
import { initTracer } from "../../utils/tracer"

type MaybePhantomActivity =
  ReturnType<typeof reporter.phantomActivity> | undefined

const tracerReadyPromise = initTracer(
  process.env.GATSBY_OPEN_TRACING_CONFIG_FILE ?? ``
)

export class GraphQLEngine {
  // private schema: GraphQLSchema
  declare private runnerPromise?: Promise<GraphQLRunner>

  constructor({ dbPath }: { dbPath: string }) {
    setupLmdbStore({ dbPath })
    // ランナーの初期化をできるだけ早く始める
    this.getRunner()
  }

  private setupPathPrefix(pathPrefix: string): void {
    if (pathPrefix) {
      store.dispatch({
        type: `SET_PROGRAM`,
        payload: {
          prefixPaths: true,
        },
      })

      store.dispatch({
        type: `SET_SITE_CONFIG`,
        payload: {
          ...store.getState().config,
          pathPrefix,
        },
      })
    }
  }

  private async _doGetRunner(): Promise<GraphQLRunner> {
    await tracerReadyPromise

    const wrapActivity = reporter.phantomActivity(`Initializing GraphQL Engine`)
    wrapActivity.start()
    try {
      // @ts-ignore PATH_PREFIX is being "inlined" by bundler
      this.setupPathPrefix(PATH_PREFIX)

      // @ts-ignore SCHEMA_SNAPSHOT is being "inlined" by bundler
      store.dispatch(actions.createTypes(SCHEMA_SNAPSHOT))

      // TODO: FLATTENED_PLUGINS は、gatsby-config のプラグインオプションとマージする必要がある
      //  （シリアライズできないオプション、つまり関数があるかもしれないため）
      store.dispatch({
        type: `SET_SITE_FLATTENED_PLUGINS`,
        payload: flattenedPlugins,
      })

      for (const plugin of gatsbyNodes) {
        const { name, module, importKey } = plugin
        setGatsbyPluginCache(
          { name, resolve: ``, importKey },
          `gatsby-node`,
          module
        )
      }
      for (const plugin of gatsbyWorkers) {
        const { name, module, importKey } = plugin
        setGatsbyPluginCache(
          { name, resolve: ``, importKey },
          `gatsby-worker`,
          module
        )
      }

      await apiRunnerNode(`onPluginInit`, { parentSpan: wrapActivity.span })
      await apiRunnerNode(`createSchemaCustomization`, {
        parentSpan: wrapActivity.span,
      })

      // ビルドを実行する
      // 注: スキーマのスナップショットに頼っているので、推論のメタデータはスキップする
      await build({ fullMetadataBuild: false, parentSpan: wrapActivity.span })

      return new GraphQLRunner(store)
    } finally {
      wrapActivity.end()
    }
  }

  private async getRunner(): Promise<GraphQLRunner> {
    if (!this.runnerPromise) {
      this.runnerPromise = this._doGetRunner()
    }
    return this.runnerPromise
  }

  public async ready(): Promise<void> {
    // 内部のランナーを自由に公開したくはない。`runQuery` 関数はすでに公開している。
    // 内部のランナーの仕組みは変わりうるので、公開 API にすべきではない。
    // ここでは、準備ができるのを待つ手段だけを公開したい
    await this.getRunner()
  }

  public async runQuery(
    query: string | Source,
    context: Record<string, any> = {},
    opts?: IQueryOptions
  ): Promise<ExecutionResult> {
    const engineContext = {
      requestId: uuid.v4(),
    }

    const doRunQuery = async (): Promise<ExecutionResult> => {
      if (!opts) {
        opts = {
          queryName: `GraphQL Engine query`,
          parentSpan: undefined,
        }
      }

      let gettingRunnerActivity: MaybePhantomActivity
      let graphqlRunner: GraphQLRunner
      try {
        if (opts.parentSpan) {
          gettingRunnerActivity = reporter.phantomActivity(
            `Waiting for graphql runner to init`,
            {
              parentSpan: opts.parentSpan,
            }
          )
          gettingRunnerActivity.start()
        }
        graphqlRunner = await this.getRunner()
      } finally {
        if (gettingRunnerActivity) {
          gettingRunnerActivity.end()
        }
      }

      // `parentSpan` を渡せば、graphqlRunner は自分の Span を作成する
      const result = await graphqlRunner.query(query, context, opts)

      let waitingForJobsCreatedByCurrentRequestActivity: MaybePhantomActivity
      try {
        if (opts.parentSpan) {
          waitingForJobsCreatedByCurrentRequestActivity =
            reporter.phantomActivity(`Waiting for jobs to finish`, {
              parentSpan: opts.parentSpan,
            })
          waitingForJobsCreatedByCurrentRequestActivity.start()
        }
        await waitJobsByRequest(engineContext.requestId)
      } finally {
        if (waitingForJobsCreatedByCurrentRequestActivity) {
          waitingForJobsCreatedByCurrentRequestActivity.end()
        }
      }
      return result
    }

    try {
      return await runWithEngineContext(engineContext, doRunQuery)
    } finally {
      // ジョブからリクエストへの対応付けをリセットする
      store.dispatch({
        type: `CLEAR_JOB_V2_CONTEXT`,
        payload: engineContext,
      })
    }
  }

  /**
   * @deprecated 代わりに page-ssr モジュールから export されている findEnginePageByPath を使うこと
   */
  public findPageByPath(pathName: string): IGatsbyPage | undefined {
    // `findPageByPath` が redux の `pages` スライスの代わりに、
    // データストアの SitePage ノードを使うようにするためのアダプター
    const state = {
      pages: {
        get(pathName: string): IGatsbyPage | undefined {
          return getDataStore().getNode(`SitePage ${pathName}`) as
            IGatsbyPage | undefined
        },
        values(): Iterable<IGatsbyPage> {
          return getDataStore().iterateNodesByType(
            `SitePage`
          ) as Iterable<IGatsbyPage>
        },
      },
    } as unknown as IGatsbyState

    return findPageByPath(state, pathName, false)
  }
}

export default { GraphQLEngine }
