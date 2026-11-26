import { stripVTControlCharacters } from "util"
import parseMetadata from "../parse"

describe(`transformer-react-doc-gen: parse`, () => {
  it(`adds a code frame that points at the syntax error`, () => {
    const content = [`import React from "react"`, `const a = ;`].join(`\n`)

    let error
    try {
      parseMetadata(content, { absolutePath: `/site/src/button.js` })
    } catch (err) {
      error = err
    }

    expect(error).toBeDefined()
    expect(error.loc).toEqual(expect.objectContaining({ line: 2, column: 10 }))
    // コンソールの色を取り除いて比較する
    expect(stripVTControlCharacters(error.codeFrame)).toBe(
      [
        `  1 | import React from "react"`,
        `> 2 | const a = ;`,
        `    |           ^`,
      ].join(`\n`)
    )
  })
})
