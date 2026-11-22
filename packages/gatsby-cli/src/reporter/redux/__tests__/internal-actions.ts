import { Dispatch, CombinedState } from "redux"

import { ActivityStatuses } from "../../constants"
import { ISetStatus, IGatsbyCLIState } from "../types"
import { GatsbyCLIStore } from "../"

jest.useFakeTimers()

describe(`setStatus action creator`, () => {
  let mockStatus: ActivityStatuses | "" = ``
  let setStatus

  const dispatchMockFn: Dispatch<ISetStatus> = <T extends ISetStatus>(
    action: T
  ): T => {
    mockStatus = action.payload
    return action
  }

  const dispatch = jest.fn(dispatchMockFn)

  const setStatusWithDispatch = <T extends ISetStatus>(
    status: ActivityStatuses | ""
  ): T => setStatus(status)(dispatch)

  beforeAll(async () => {
    jest.doMock(`../`, () => {
      return {
        getStore: (): Partial<GatsbyCLIStore> => {
          return {
            getState: (): CombinedState<{ logs: IGatsbyCLIState }> => {
              return {
                logs: { status: mockStatus, messages: [], activities: {} },
              }
            },
          }
        },
      }
    })
    jest.resetModules()
    setStatus = (await import(`../internal-actions`)).setStatus
  })

  afterAll(() => {
    jest.unmock(`../`)
  })

  beforeEach(() => {
    mockStatus = ``
    dispatch.mockClear()
  })

  it(`debounces SUCCESS in case activities don't overlap`, () => {
    setStatusWithDispatch(ActivityStatuses.InProgress)
    setStatusWithDispatch(ActivityStatuses.Success)
    setStatusWithDispatch(ActivityStatuses.InProgress)
    setStatusWithDispatch(ActivityStatuses.Success)

    // 最初の IN_PROGRESS イベントだけが送られるはずである
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: `SET_STATUS`,
      payload: ActivityStatuses.InProgress,
    })

    jest.runOnlyPendingTimers()

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: `SET_STATUS`,
      payload: ActivityStatuses.Success,
    })
  })

  it(`debounces FAILED in case activities don't overlap`, () => {
    setStatusWithDispatch(ActivityStatuses.InProgress)
    setStatusWithDispatch(ActivityStatuses.Success)
    setStatusWithDispatch(ActivityStatuses.InProgress)
    setStatusWithDispatch(ActivityStatuses.Failed)

    // 最初の IN_PROGRESS イベントだけが送られるはずである
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: `SET_STATUS`,
      payload: ActivityStatuses.InProgress,
    })

    jest.runOnlyPendingTimers()

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: `SET_STATUS`,
      payload: ActivityStatuses.Failed,
    })
  })

  it(`doesn't wrongly emit SUCCESS when we are still in progress `, () => {
    setStatusWithDispatch(ActivityStatuses.InProgress)
    setStatusWithDispatch(ActivityStatuses.Success)
    setStatusWithDispatch(ActivityStatuses.InProgress)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: `SET_STATUS`,
      payload: ActivityStatuses.InProgress,
    })

    jest.runOnlyPendingTimers()

    // まだ進行中なので、最初の IN_PROGRESS 以外は何も送られないはずである
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
