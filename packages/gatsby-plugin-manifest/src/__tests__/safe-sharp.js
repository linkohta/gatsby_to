describe(`safe-sharp`, () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    jest.dontMock(`sharp`)
    jest.dontMock(`gatsby/sharp`)
  })

  it(`uses gatsby/sharp when it is available`, () => {
    const getSharpInstance = jest.fn()
    jest.doMock(`gatsby/sharp`, () => getSharpInstance, { virtual: true })

    expect(require(`../safe-sharp`)).toBe(getSharpInstance)
    expect(console.error).toBe(originalConsoleError)
  })

  it(`falls back to its own sharp when gatsby/sharp is not available`, async () => {
    const fakeSharp = { simd: jest.fn(), concurrency: jest.fn() }
    jest.doMock(
      `gatsby/sharp`,
      () => {
        throw new Error(`Cannot find module 'gatsby/sharp'`)
      },
      { virtual: true }
    )
    jest.doMock(`sharp`, () => fakeSharp)

    const getSharpInstance = require(`../safe-sharp`)

    expect(console.error).toBe(originalConsoleError)
    // sharp は呼び出されるまで読み込まれない
    expect(fakeSharp.simd).not.toHaveBeenCalled()
    await expect(getSharpInstance()).resolves.toBe(fakeSharp)
    expect(fakeSharp.simd).toHaveBeenCalledTimes(1)
    expect(fakeSharp.concurrency).toHaveBeenCalledWith(1)
  })
})
