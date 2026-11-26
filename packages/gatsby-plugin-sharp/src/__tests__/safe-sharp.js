const os = require(`os`)

const INCOMPATIBLE = `Incompatible library version: sharp.node requires version 1.0.0 or later`

const npmList = {
  dependencies: {
    "gatsby-plugin-sharp": {
      dependencies: { sharp: { version: `0.35.5` } },
    },
    "gatsby-plugin-old": {
      dependencies: {
        nested: { dependencies: { sharp: { version: `0.22.1` } } },
      },
    },
  },
}

describe(`safe-sharp`, () => {
  let consoleError
  let execSync
  const originalConsoleError = console.error

  beforeEach(() => {
    jest.resetModules()
    consoleError = jest.fn()
    console.error = consoleError
    execSync = jest.fn(() => JSON.stringify(npmList))
    jest.doMock(`child_process`, () => {
      return { ...jest.requireActual(`child_process`), execSync }
    })
    // ロックファイルの有無で結果が変わらないよう、何もないフォルダーを cwd にする
    jest.spyOn(process, `cwd`).mockReturnValue(os.tmpdir())
  })

  afterEach(() => {
    console.error = originalConsoleError
    jest.restoreAllMocks()
    jest.dontMock(`sharp`)
    jest.dontMock(`child_process`)
  })

  it(`exports sharp and restores console.error when sharp loads`, () => {
    const fakeSharp = { simd: jest.fn(), concurrency: jest.fn() }
    jest.doMock(`sharp`, () => fakeSharp)

    expect(require(`../safe-sharp`)).toBe(fakeSharp)
    expect(console.error).toBe(consoleError)
    expect(consoleError).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()
  })

  it(`prints which packages need an update when sharp throws an incompatible version error`, () => {
    jest.doMock(`sharp`, () => {
      throw new Error(INCOMPATIBLE)
    })

    expect(() => require(`../safe-sharp`)).toThrow(INCOMPATIBLE)
    expect(execSync).toHaveBeenCalledWith(`npm list sharp --json`, {
      encoding: `utf-8`,
    })
    expect(console.error).toBe(consoleError)
    expect(consoleError.mock.calls).toMatchSnapshot()
  })

  it(`prints the guidance when sharp reports the error through console.error`, () => {
    const fakeSharp = {}
    jest.doMock(`sharp`, () => {
      console.error(INCOMPATIBLE, `extra`)
      return fakeSharp
    })

    expect(require(`../safe-sharp`)).toBe(fakeSharp)
    expect(console.error).toBe(consoleError)
    expect(consoleError.mock.calls).toMatchSnapshot()
  })

  it(`prints generic instructions when the installed packages can't be listed`, () => {
    execSync.mockImplementation(() => {
      throw new Error(`npm failed`)
    })
    jest.doMock(`sharp`, () => {
      throw new Error(INCOMPATIBLE)
    })

    expect(() => require(`../safe-sharp`)).toThrow(INCOMPATIBLE)
    expect(consoleError.mock.calls).toMatchSnapshot()
  })

  it(`rethrows other errors without printing guidance`, () => {
    jest.doMock(`sharp`, () => {
      throw new Error(`Cannot find module 'sharp'`)
    })

    expect(() => require(`../safe-sharp`)).toThrow(`Cannot find module 'sharp'`)
    expect(console.error).toBe(consoleError)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
