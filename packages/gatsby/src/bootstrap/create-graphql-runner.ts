import * as stackTrace from "stack-trace"
import { Span } from "opentracing"
import { ExecutionResult, Source } from "graphql"
import { Store } from "redux"

import { GraphQLRunner } from "../query/graphql-runner"
import errorParser from "../query/error-parser"
import { emitter } from "../redux"
import { Reporter } from "../.."
import { IGatsbyState } from "../redux/types"
import { IMatch } from "../types"

export type Runner = (
  query: string | Source,
  context: Record<string, any>
) => Promise<ExecutionResult>

const findCreatePagesFrame = (
  error: Error
): stackTrace.StackFrame | undefined =>
  stackTrace
    .parse(error)
    .find(frame => /createPages/.test(frame.getFunctionName()))

const GRAPHQL_EXECUTION_PATH =
  /[\\/]graphql[\\/](?:__dev__[\\/])?execution[\\/]/

const hasGraphQLExecutionFrame = (error: Error): boolean =>
  stackTrace
    .parse(error)
    .some(frame => GRAPHQL_EXECUTION_PATH.test(frame.getFileName() ?? ``))

export const createGraphQLRunner = (
  store: Store<IGatsbyState>,
  reporter: Reporter,
  {
    parentSpan,
    graphqlTracing,
  }: { parentSpan: Span | undefined; graphqlTracing?: boolean } = {
    parentSpan: undefined,
    graphqlTracing: false,
  }
): Runner => {
  // TODO: 変更された state の追跡を GraphQLRunner 自体の中へ移す。https://github.com/gatsbyjs/gatsby/issues/20941
  let runner: GraphQLRunner | undefined = new GraphQLRunner(store, {
    graphqlTracing,
  })

  const eventTypes: Array<string> = [
    `DELETE_CACHE`,
    `CREATE_NODE`,
    `DELETE_NODE`,
    `SET_SCHEMA_COMPOSER`,
    `SET_SCHEMA`,
    `ADD_FIELD_TO_NODE`,
    `ADD_CHILD_NODE_TO_PARENT_NODE`,
  ]

  eventTypes.forEach(type => {
    emitter.on(type, () => {
      runner = undefined
    })
  })

  return (query, context): ReturnType<Runner> => {
    // graphql 17 の実行エンジンは、非同期のリゾルバーが投げたエラーのスタックを呼び出し元までつなげない
    // （graphql 16 では createPages までつながっていた）。そのままでは createPages から呼ばれたかどうかを
    // エラーのスタックだけでは判断できないので、呼び出し時点のスタックを控えておく。
    const callSite = new Error()

    if (!runner) {
      runner = new GraphQLRunner(store, {
        graphqlTracing,
      })
    }
    return runner
      .query(query, context, {
        queryName: `gatsby-node query`,
        parentSpan,
      })
      .then(result => {
        if (result.errors) {
          const structuredErrors = result.errors
            .map(e => {
              // graphql が呼ばれたファイルを見つける。
              // スタックが graphql の実行エンジンの中で途切れているエラーは、控えておいた呼び出し時点のスタックから探す。
              const file =
                findCreatePagesFrame(e) ??
                (hasGraphQLExecutionFrame(e)
                  ? findCreatePagesFrame(callSite)
                  : undefined)

              if (file) {
                const structuredError = errorParser({
                  message: e.message,
                  location: {
                    start: {
                      line: file.getLineNumber(),
                      column: file.getColumnNumber(),
                    },
                  },
                  filePath: file.getFileName(),
                  error: e,
                })
                structuredError.context = {
                  ...structuredError.context,
                  fromGraphQLFunction: true,
                }
                return structuredError
              }

              return null
            })
            .filter(Boolean as unknown as (match) => match is IMatch)

          if (structuredErrors.length) {
            // ビルド時の panic はプロセスを終了する
            reporter.panicOnBuild(structuredErrors)
          }
        }

        return result
      })
  }
}
