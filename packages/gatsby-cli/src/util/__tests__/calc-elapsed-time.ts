import { calcElapsedTime, elapsedNanoseconds } from "../calc-elapsed-time"

describe(`calc-elapsed-time`, () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it(`converts the elapsed [seconds, nanoseconds] tuple to nanoseconds`, () => {
    const hrtime = jest
      .spyOn(process, `hrtime`)
      .mockReturnValue([2, 345678901] as [number, number])

    expect(elapsedNanoseconds([1, 0])).toBe(BigInt(`2345678901`))
    expect(hrtime).toHaveBeenCalledWith([1, 0])
  })

  it(`formats the elapsed time as seconds with three decimals`, () => {
    jest
      .spyOn(process, `hrtime`)
      .mockReturnValue([2, 345678901] as [number, number])

    expect(calcElapsedTime([1, 0])).toBe(`2.346`)
  })
})
