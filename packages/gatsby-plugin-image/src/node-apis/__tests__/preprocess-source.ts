import { stripVTControlCharacters } from "util"
import type { PreprocessSourceArgs } from "gatsby"
import { preprocessSource } from "../preprocess-source"

// 画像の書き出しは sharp を読み込む。ここではエラーの報告だけを確認する
jest.mock(`../image-processing`, () => {
  return {
    writeImages: jest.fn(),
  }
})

const contents = `import * as React from "react"
import { StaticImage } from "gatsby-plugin-image"

export default function Page({ width }) {
  return <StaticImage src="./image.png" alt="" width={width} />
}
`

describe(`preprocessSource`, () => {
  it(`marks the prop that cannot be extracted in the code frame`, async () => {
    const reporter = {
      setErrorMap: jest.fn(),
      error: jest.fn(),
    }

    await preprocessSource({
      filename: `/site/src/pages/index.js`,
      contents,
      pathPrefix: ``,
      cache: {},
      reporter,
      store: {
        getState: () => {
          return { program: { directory: `/site` } }
        },
      },
      createNodeId: jest.fn(),
      actions: { createNode: jest.fn() },
    } as unknown as PreprocessSourceArgs)

    expect(reporter.error).toHaveBeenCalledTimes(1)
    const [error] = reporter.error.mock.calls[0]
    expect(error.id).toBe(`95314`)
    expect(error.context.prop).toBe(`width`)
    // コンソールの色を取り除いて比較する
    expect(stripVTControlCharacters(error.context.codeFrame))
      .toMatchInlineSnapshot(`
      "  1 | import * as React from \\"react\\"
        2 | import { StaticImage } from \\"gatsby-plugin-image\\"
        3 |
        4 | export default function Page({ width }) {
      > 5 |   return <StaticImage src=\\"./image.png\\" alt=\\"\\" width={width} />
          |                                                ^^^^^^^^^^^^^
        6 | }
        7 |"
    `)
  })
})
