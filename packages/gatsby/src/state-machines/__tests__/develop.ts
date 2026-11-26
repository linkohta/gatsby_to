/* eslint-disable @typescript-eslint/no-explicit-any */
import { developMachine } from "../develop"
import { initializeDataMachine } from "../data-layer"
import { createActor, fromPromise, Actor } from "xstate"
import { IProgram } from "../../commands/types"

const actions = {
  assignStoreAndWorkerPool: jest.fn(),
  assignServiceResult: jest.fn(),
  callApi: jest.fn(),
  finishParentSpan: jest.fn(),
  saveDbState: jest.fn(),
  logError: jest.fn(),
  panic: jest.fn(),
  panicBecauseOfInfiniteLoop: jest.fn(),
}

const services = {
  initialize: jest.fn(),
  initializeData: jest.fn(),
  // モックにしないと本物の postBootstrap が動く。そのアクティビティの終了時に reporter が
  // 1 秒のタイマーを仕掛けるので、Jest のワーカープロセスが時間内に終了できなくなる
  postBootstrap: jest.fn(),
  reloadData: jest.fn(),
  runQueries: jest.fn(),
  startWebpackServer: jest.fn(),
  recompile: jest.fn(),
  waitForMutations: jest.fn(),
  recreatePages: jest.fn(),
}

const throwService = async (): Promise<void> => {
  throw new Error(`fail`)
}

const rejectService = async (): Promise<void> => Promise.reject(`fail`)

// モックが何も返さないサービスは、完了しないものとして扱う。完了は、テストが
// `xstate.done.actor.<id>` のイベントを送って知らせる
const pending = new Promise<never>(() => {})

const machine = developMachine.provide({
  actions,
  actors: Object.fromEntries(
    Object.entries(services).map(([name, service]) => [
      name,
      fromPromise(async ({ input }) => service(input) ?? pending),
    ])
  ),
})

const interpret = (logic: typeof machine): Actor<typeof machine> =>
  createActor(logic, { input: { program: {} as IProgram } })

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const resetMocks = (mocks: Record<string, jest.Mock>): void =>
  Object.values(mocks).forEach(mock => mock.mockReset())

const resetAllMocks = (): void => {
  resetMocks(services)
  resetMocks(actions)
}

describe(`the top-level develop state machine`, () => {
  beforeEach(() => {
    resetAllMocks()
  })

  it(`initialises`, async () => {
    const service = interpret(machine)
    service.start()
    expect(service.getSnapshot().value).toBe(`initializing`)
  })

  it(`runs node mutation during initialising data state`, () => {
    const payload = { foo: 1 }
    const service = interpret(machine)

    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    expect(service.getSnapshot().value).toBe(`initializingData`)
    service.send({ type: `ADD_NODE_MUTATION`, ...payload })
    expect(actions.callApi).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: `ADD_NODE_MUTATION`,
          ...payload,
        }),
      }),
      undefined
    )
  })

  it(`marks source file as dirty during node sourcing`, () => {
    const service = interpret(machine)

    service.start()
    expect(service.getSnapshot().value).toBe(`initializing`)
    service.send({ type: `xstate.done.actor.initialize` })
    expect(service.getSnapshot().value).toBe(`initializingData`)
    expect(service.getSnapshot().context.sourceFilesDirty).toBeFalsy()
    service.send({ type: `SOURCE_FILE_CHANGED` })
    expect(service.getSnapshot().context.sourceFilesDirty).toBeTruthy()
  })

  // これが現在の動作だが、将来はキューに入れられるようになる
  it(`handles a webhook during node sourcing`, () => {
    const webhookBody = { foo: 1 }
    const service = interpret(machine)
    service.start()
    expect(service.getSnapshot().value).toBe(`initializing`)
    service.send({ type: `xstate.done.actor.initialize` })
    expect(service.getSnapshot().value).toBe(`initializingData`)
    expect(service.getSnapshot().context.webhookBody).toBeUndefined()
    service.send({ type: `WEBHOOK_RECEIVED`, payload: { webhookBody } })
    expect(service.getSnapshot().context.webhookBody).toEqual(webhookBody)
    expect(services.reloadData).toHaveBeenCalled()
  })

  it(`runs a node mutation during query running and marks node as dirty`, () => {
    const payload = { foo: 1 }

    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    expect(service.getSnapshot().context.nodeMutationBatch).toBeUndefined()
    expect(service.getSnapshot().context.nodesMutatedDuringQueryRun).toBeFalsy()

    service.send({ type: `ADD_NODE_MUTATION`, payload })
    expect(
      service.getSnapshot().context.nodesMutatedDuringQueryRun
    ).toBeTruthy()
    expect(actions.callApi).toHaveBeenCalled()
  })

  it(`increments the recompile count if nodes were mutated during query running`, () => {
    const payload = { foo: 1 }

    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.send({ type: `ADD_NODE_MUTATION`, payload })
    service.send({ type: `xstate.done.actor.run-queries` })
    expect(
      service.getSnapshot().context.nodesMutatedDuringQueryRunRecompileCount
    ).toEqual(1)
    expect(service.getSnapshot().context.nodesMutatedDuringQueryRun).toBeFalsy()
  })

  it(`resets the recompile count if nodes were not mutated during query running`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    service.getSnapshot().context.nodesMutatedDuringQueryRunRecompileCount = 1
    service.send({ type: `xstate.done.actor.run-queries` })
    expect(
      service.getSnapshot().context.nodesMutatedDuringQueryRunRecompileCount
    ).toEqual(0)
    expect(service.getSnapshot().context.nodesMutatedDuringQueryRun).toBeFalsy()
  })

  it(`panics if the recompile count is above the limit`, () => {
    const payload = { foo: 1 }

    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })

    service.send({ type: `ADD_NODE_MUTATION`, payload })
    service.send({ type: `xstate.done.actor.run-queries` })
    for (let index = 0; index < 6; index++) {
      service.send({ type: `xstate.done.actor.recreate-pages` })
      service.send({ type: `ADD_NODE_MUTATION`, payload })
      service.send({ type: `xstate.done.actor.run-queries` })
    }
    expect(actions.panicBecauseOfInfiniteLoop).toHaveBeenCalled()
  })

  it(`starts webpack if there is no compiler`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    expect(service.getSnapshot().context.compiler).toBeUndefined()
    services.startWebpackServer.mockReset()
    service.send({ type: `xstate.done.actor.run-queries` })
    expect(services.startWebpackServer).toHaveBeenCalled()
  })

  it(`recompiles if source files have changed`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `SOURCE_FILE_CHANGED` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    // そのため、代わりに webpack を起動しない
    service.getSnapshot().context.compiler = {} as any
    services.recompile.mockReset()
    service.send({ type: `xstate.done.actor.run-queries` })
    expect(services.startWebpackServer).not.toHaveBeenCalled()
    expect(services.recompile).toHaveBeenCalled()
  })

  it(`skips compilation if source files are unchanged`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    services.recompile.mockReset()
    service.send({ type: `xstate.done.actor.run-queries` })
    expect(services.startWebpackServer).not.toHaveBeenCalled()
    expect(services.recompile).not.toHaveBeenCalled()
  })

  it(`recreates pages when waiting is complete`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    service.send({ type: `xstate.done.actor.run-queries` })
    service.send({ type: `xstate.done.actor.waiting` })

    expect(services.recreatePages).toHaveBeenCalled()
  })

  it(`extracts queries when waiting requests it`, () => {
    const service = interpret(machine)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    service.send({ type: `xstate.done.actor.run-queries` })
    service.send({ type: `EXTRACT_QUERIES_NOW` })
    expect(services.runQueries).toHaveBeenCalled()
  })

  it(`panics on error during initialisation`, async () => {
    const service = interpret(machine)
    services.initialize.mockImplementationOnce(throwService)
    service.start()
    await tick()
    expect(actions.panic).toHaveBeenCalled()
  })

  it(`panics on rejection during initialisation`, async () => {
    const service = interpret(machine)
    services.initialize.mockImplementationOnce(rejectService)
    service.start()
    await tick()
    expect(actions.panic).toHaveBeenCalled()
  })

  it(`logs errors during sourcing and transitions to waiting`, async () => {
    const service = interpret(machine)
    services.initializeData.mockImplementationOnce(throwService)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    await tick()
    expect(actions.logError).toHaveBeenCalled()
    expect(service.getSnapshot().value).toEqual(`waiting`)
  })

  // xstate 5 では、子のステートマシンの中で失敗したサービスのエラーが親へ伝わる
  it(`logs errors from a service inside a child machine and transitions to waiting`, async () => {
    const service = createActor(
      machine.provide({
        actors: {
          initializeData: initializeDataMachine.provide({
            actors: { customizeSchema: fromPromise(throwService) },
          }),
        },
      }),
      { input: { program: {} as IProgram } }
    )
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    expect(service.getSnapshot().value).toBe(`initializingData`)
    await tick()
    expect(actions.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ error: new Error(`fail`) }),
      }),
      undefined
    )
    expect(service.getSnapshot().value).toEqual(`waiting`)
  })

  it(`logs errors during query running and transitions to waiting`, async () => {
    const service = interpret(machine)
    services.runQueries.mockImplementationOnce(throwService)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    await tick()
    expect(actions.logError).toHaveBeenCalled()
    expect(service.getSnapshot().value).toEqual(`waiting`)
  })

  it(`panics on errors when launching webpack`, async () => {
    const service = interpret(machine)
    services.startWebpackServer.mockImplementationOnce(throwService)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.send({ type: `xstate.done.actor.run-queries` })
    await tick()
    expect(actions.panic).toHaveBeenCalled()
  })

  it(`logs errors during compilation and transitions to waiting`, async () => {
    const service = interpret(machine)
    services.recompile.mockImplementationOnce(throwService)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    service.getSnapshot().context.sourceFilesDirty = true
    service.send({ type: `xstate.done.actor.run-queries` })
    await tick()
    expect(actions.logError).toHaveBeenCalled()
    expect(service.getSnapshot().value).toEqual(`waiting`)
  })

  it(`panics on errors while waiting`, async () => {
    const service = interpret(machine)
    services.waitForMutations.mockImplementationOnce(throwService)
    service.start()
    service.send({ type: `xstate.done.actor.initialize` })
    service.send({ type: `xstate.done.actor.initialize-data` })
    service.send({ type: `xstate.done.actor.post-bootstrap` })
    service.getSnapshot().context.compiler = {} as any
    service.send({ type: `xstate.done.actor.run-queries` })
    await tick()
    expect(actions.panic).toHaveBeenCalled()
  })
})
