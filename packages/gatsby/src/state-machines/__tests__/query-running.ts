import { queryRunningMachine } from "../query-running"
import { queryActions } from "../query-running/actions"
import { createActor, Actor, AnyActorRef } from "xstate"
import { fromService } from "../from-service"
import { IProgram } from "../../commands/types"
import { store } from "../../redux"
import reporter from "gatsby-cli/lib/reporter"
import pDefer from "p-defer"
import { IGroupedQueryIds } from "../../services/types"

const services = {
  extractQueries: jest.fn(async () => {}),
  writeOutRequires: jest.fn(async () => {}),
  calculateDirtyQueries: jest.fn(
    async (): Promise<{
      queryIds: IGroupedQueryIds
    }> => {
      return {
        queryIds: {
          pageQueryIds: [],
          staticQueryIds: [],
          sliceQueryIds: [],
        },
      }
    }
  ),
}

const machine = queryRunningMachine.provide({
  actions: queryActions,
  actors: {
    extractQueries: fromService(services.extractQueries),
    writeOutRequires: fromService(services.writeOutRequires),
    calculateDirtyQueries: fromService(services.calculateDirtyQueries),
  },
})

const interpret = (logic: typeof machine): Actor<typeof machine> =>
  createActor(logic, {
    input: {
      program: {} as IProgram,
      store,
      reporter,
      pendingQueryRuns: new Set([`/`]),
    },
  })

const resetMocks = (mocks: Record<string, jest.Mock>): void =>
  Object.values(mocks).forEach(mock => mock.mockClear())

const resetAllMocks = (): void => {
  resetMocks(services)
}

const finished = async (service: AnyActorRef): Promise<void> =>
  new Promise(resolve => {
    service.subscribe({ complete: () => resolve() })
  })

function debug(service: AnyActorRef): void {
  let last: any

  service.subscribe(state => {
    reporter.info(
      `---onTransition---\n${require(`util`).inspect(
        {
          stateValue: state.value,
          pendingQueryRuns: state.context.pendingQueryRuns,
          changedStateValue: state.value !== last?.value,
        },
        { depth: Infinity }
      )}`
    )
    last = state
  })
}

expect.extend({
  toHaveInSet(received, item) {
    if (received.has(item)) {
      return {
        pass: true,
        message: (): string =>
          `Expected ${Array.from(received)} not to contain ${item}`,
      }
    } else {
      return {
        pass: false,
        message: (): string =>
          `Expected ${Array.from(received)} not to contain ${item}`,
      }
    }
  },
})

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    interface Expect {
      toHaveInSet(item: any): any
    }
  }
}

describe(`query-running state machine`, () => {
  beforeEach(() => {
    resetAllMocks()
  })

  it(`initialises`, async () => {
    const service = interpret(machine)
    // debug(service)

    service.start()
    expect(service.getSnapshot().value).toBe(`extractingQueries`)
  })

  it(`doesn't drop pendingQueryRuns that were added during calculation of dirty queries`, async () => {
    const deferred = pDefer<{
      queryIds: IGroupedQueryIds
    }>()
    const waitForExecutionOfCalcDirtyQueries = pDefer()

    services.calculateDirtyQueries.mockImplementation(
      async (): Promise<{
        queryIds: IGroupedQueryIds
      }> => {
        waitForExecutionOfCalcDirtyQueries.resolve()

        // サービスを再開する前に、テストがコードを実行できるようにする

        await deferred.promise

        return {
          queryIds: {
            pageQueryIds: [],
            staticQueryIds: [],
            sliceQueryIds: [],
          },
        }
      }
    )

    const service = interpret(machine)
    // debug(service)

    service.send({
      type: `QUERY_RUN_REQUESTED`,
      payload: {
        pagePath: `/bar/`,
      },
    })

    service.start()

    await waitForExecutionOfCalcDirtyQueries.promise

    // calcDirtyQueries サービスの実行の途中である
    // ページ /foo/ に対して QUERY_RUN_REQUESTED を dispatch する
    service.send({
      type: `QUERY_RUN_REQUESTED`,
      payload: {
        pagePath: `/foo/`,
      },
    })

    deferred.resolve()

    // ステートマシンを最終状態まで進める
    await finished(service)

    // calcDirtyQueries サービスの実行中にリクエストされたページも含めて、
    // リクエストされたすべてのページを渡して calculateDirtyQueries サービスが
    // 呼ばれたことを確認する
    expect(services.calculateDirtyQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        currentlyHandledPendingQueryRuns: expect.toHaveInSet(`/`),
      })
    )

    expect(services.calculateDirtyQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        currentlyHandledPendingQueryRuns: expect.toHaveInSet(`/bar/`),
      })
    )

    expect(services.calculateDirtyQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        currentlyHandledPendingQueryRuns: expect.toHaveInSet(`/foo/`),
      })
    )
  })
})
