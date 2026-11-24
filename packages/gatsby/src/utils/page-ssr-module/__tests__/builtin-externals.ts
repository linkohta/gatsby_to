import { getBuiltinModuleExternals } from "../builtin-externals"

describe(`getBuiltinModuleExternals`, () => {
  const externals = getBuiltinModuleExternals()

  it(`loads builtin modules at runtime`, () => {
    expect(externals.path).toBe(`commonjs path`)
    expect(externals.os).toBe(`commonjs os`)
  })

  it(`routes fs through the engine's fs wrapper`, () => {
    expect(externals.fs).toBe(`global _actualFsWrapper`)
  })

  it(`treats the node: prefix the same way`, () => {
    expect(externals[`node:path`]).toBe(`commonjs path`)
    expect(externals[`node:process`]).toBe(`commonjs process`)
    expect(externals[`node:tty`]).toBe(`commonjs tty`)
    expect(externals[`node:fs`]).toBe(`global _actualFsWrapper`)
  })
})
