import type { Store } from "gatsby"
import { enhanceMdxOptions } from "../plugin-options"

const createHelpers = (
  config: Record<string, unknown>
): Parameters<typeof enhanceMdxOptions>[1] => {
  return {
    getNode: jest.fn(),
    getNodesByType: jest.fn(),
    pathPrefix: ``,
    reporter: {} as Parameters<typeof enhanceMdxOptions>[1][`reporter`],
    cache: {} as Parameters<typeof enhanceMdxOptions>[1][`cache`],
    store: {
      getState: () => {
        return { config }
      },
    } as unknown as Store,
  }
}

describe(`enhanceMdxOptions`, () => {
  describe(`jsxRuntime`, () => {
    it(`compiles with the automatic runtime when Gatsby uses the classic runtime (the default)`, async () => {
      const options = await enhanceMdxOptions(
        {},
        createHelpers({ jsxRuntime: `classic` })
      )

      expect(options.jsxRuntime).toBe(`automatic`)
      expect(options.jsxImportSource).toBe(`react`)
    })

    it(`compiles with the automatic runtime and the configured import source`, async () => {
      const options = await enhanceMdxOptions(
        {},
        createHelpers({
          jsxRuntime: `automatic`,
          jsxImportSource: `@emotion/react`,
        })
      )

      expect(options.jsxRuntime).toBe(`automatic`)
      expect(options.jsxImportSource).toBe(`@emotion/react`)
    })

    it(`keeps the classic runtime when a pragma option is set in mdxOptions`, async () => {
      const options = await enhanceMdxOptions(
        { mdxOptions: { pragma: `h`, pragmaImportSource: `preact` } },
        createHelpers({ jsxRuntime: `classic` })
      )

      expect(options.jsxRuntime).toBe(`classic`)
      expect(options.pragma).toBe(`h`)
    })

    it(`uses the automatic runtime when Gatsby is configured for it even if a pragma option is set`, async () => {
      const options = await enhanceMdxOptions(
        { mdxOptions: { pragma: `h` } },
        createHelpers({ jsxRuntime: `automatic` })
      )

      expect(options.jsxRuntime).toBe(`automatic`)
    })
  })

  it(`does not pass the removed useDynamicImport option`, async () => {
    const options = await enhanceMdxOptions({}, createHelpers({}))

    expect(options).not.toHaveProperty(`useDynamicImport`)
  })

  it(`passes hast element nodes through remark-rehype and keeps other remarkRehypeOptions`, async () => {
    const options = await enhanceMdxOptions(
      { mdxOptions: { remarkRehypeOptions: { footnoteLabel: `Notes` } } },
      createHelpers({})
    )

    expect(options.remarkRehypeOptions).toEqual({
      footnoteLabel: `Notes`,
      passThrough: [`element`],
    })
  })
})
