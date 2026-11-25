jest.mock(`graphql`)

import { createGraphQLRunner } from "../create-graphql-runner"
import { execute, validate, parse } from "graphql"
import { globalTracer } from "opentracing"

parse.mockImplementation(() => {
  return {}
})
validate.mockImplementation(() => [])

const createStore = (schema = {}) => {
  return {
    getState: () => {
      return {
        schema,
        schemaCustomization: {
          composer: {},
        },
      }
    },
  }
}

const tracingContext = {
  graphqlTracing: false,
  parentSpan: globalTracer().startSpan(`test`),
}

describe(`grapqhl-runner`, () => {
  let reporter

  beforeEach(() => {
    reporter = {
      panicOnBuild: jest.fn(),
    }
  })

  it(`should return the result when grapqhl has no errors`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    const expectation = {
      data: {
        gatsby: `is awesome`,
      },
    }
    execute.mockImplementation(() => Promise.resolve(expectation))

    const result = await graphqlRunner(``, {})
    expect(reporter.panicOnBuild).not.toHaveBeenCalled()
    expect(result).toBe(expectation)
  })

  it(`should return an errors array when structured errors found`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    const expectation = {
      errors: [
        {
          message: `Cannot query field boyhowdy on RootQueryType`,
          locations: [{ line: 1, column: 3 }],
        },
      ],
    }
    execute.mockImplementation(() => Promise.resolve(expectation))

    const result = await graphqlRunner(``, {})
    expect(reporter.panicOnBuild).not.toHaveBeenCalled()
    expect(result).toBe(expectation)
  })

  it(`should throw a structured error when created from createPage file`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    const errorObject = {
      stack: `Error
      at createPages (my-gatsby-project/gatsby-node.js:32:17)
      `,
      message: `Cannot query field boyhowdy on RootQueryType`,
    }

    execute.mockImplementation(() =>
      Promise.resolve({
        errors: [errorObject],
      })
    )

    await graphqlRunner(``, {})
    expect(reporter.panicOnBuild).toHaveBeenCalled()
    expect(reporter.panicOnBuild).toMatchSnapshot()
  })

  // graphql 17 では、非同期のリゾルバーが投げたエラーのスタックが実行エンジンの中で途切れる
  const asyncResolverError = {
    stack: `Error: async resolver failure
      at Object.resolve (my-gatsby-project/gatsby-node.js:5:11)
      at async Executor.completePromisedValue (file:///my-gatsby-project/node_modules/graphql/execution/Executor.mjs:337:30)
      at async Promise.all (index 0)
      `,
    message: `async resolver failure`,
  }

  it(`should throw a structured error when the stack ends inside graphql and the runner was called from createPages`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    execute.mockImplementation(() =>
      Promise.resolve({
        errors: [asyncResolverError],
      })
    )

    const createPages = async () => {
      await graphqlRunner(``, {})
    }
    await createPages()

    expect(reporter.panicOnBuild).toHaveBeenCalledTimes(1)
    expect(reporter.panicOnBuild.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        filePath: __filename,
        context: {
          fromGraphQLFunction: true,
          sourceMessage: `async resolver failure`,
        },
      }),
    ])
  })

  it(`should not throw when the stack ends inside graphql and the runner was not called from createPages`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    const expectation = {
      errors: [asyncResolverError],
    }
    execute.mockImplementation(() => Promise.resolve(expectation))

    const result = await graphqlRunner(``, {})
    expect(reporter.panicOnBuild).not.toHaveBeenCalled()
    expect(result).toBe(expectation)
  })

  it(`should not throw when the stack has no frame of graphql even if the runner was called from createPages`, async () => {
    const graphqlRunner = createGraphQLRunner(
      createStore(),
      reporter,
      tracingContext
    )

    const expectation = {
      errors: [
        {
          stack: `Error: Failed to load query batch
      at my-gatsby-project/node_modules/gatsby-source-graphql/batching/dataloader-link.js:40:13
      `,
          message: `Failed to load query batch`,
        },
      ],
    }
    execute.mockImplementation(() => Promise.resolve(expectation))

    const createPages = async () => graphqlRunner(``, {})
    const result = await createPages()

    expect(reporter.panicOnBuild).not.toHaveBeenCalled()
    expect(result).toBe(expectation)
  })
})
