import { codeFrameColumns, fromBabelPosition } from "../code-frame"

const source = [`const a = 1`, `function foo() {`, `  return a + 2`, `}`].join(
  `\n`
)

// 期待値は `@babel/code-frame` 7 の出力である
describe(`codeFrameColumns`, () => {
  it(`points at a 1-based column`, () => {
    expect(codeFrameColumns(source, { start: { line: 1, column: 7 } }))
      .toMatchInlineSnapshot(`
      "> 1 | const a = 1
          |       ^
        2 | function foo() {
        3 |   return a + 2
        4 | }"
    `)
  })

  it(`points at the first character for column 1`, () => {
    expect(codeFrameColumns(source, { start: { line: 2, column: 1 } }))
      .toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
          | ^
        3 |   return a + 2
        4 | }"
    `)
  })

  it.each([
    [`0`, { line: 2, column: 0 }],
    [`undefined`, { line: 2, column: undefined }],
    [`omitted`, { line: 2 }],
  ])(`only marks the line when the column is %s`, (_label, start) => {
    expect(codeFrameColumns(source, { start })).toBe(
      [
        `  1 | const a = 1`,
        `> 2 | function foo() {`,
        `  3 |   return a + 2`,
        `  4 | }`,
      ].join(`\n`)
    )
  })

  it(`marks a range on a single line`, () => {
    expect(
      codeFrameColumns(source, {
        start: { line: 2, column: 10 },
        end: { line: 2, column: 13 },
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
          |          ^^^
        3 |   return a + 2
        4 | }"
    `)
  })

  it(`marks a single column when the end has no column`, () => {
    expect(
      codeFrameColumns(source, {
        start: { line: 2, column: 10 },
        end: { line: 2, column: undefined },
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
          |          ^
        3 |   return a + 2
        4 | }"
    `)
  })

  it(`marks a range over multiple lines`, () => {
    expect(
      codeFrameColumns(source, {
        start: { line: 2, column: 10 },
        end: { line: 3, column: 8 },
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
          |          ^^^^^^^
      > 3 |   return a + 2
          | ^^^^^^^^
        4 | }"
    `)
  })

  it(`marks whole lines when the start of a multi-line range has no column`, () => {
    expect(
      codeFrameColumns(source, {
        start: { line: 2, column: 0 },
        end: { line: 3, column: 8 },
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
      > 3 |   return a + 2
        4 | }"
    `)
  })

  it(`does not throw when the end line is past the end of the source`, () => {
    expect(
      codeFrameColumns(source, {
        start: { line: 3, column: 3 },
        end: { line: 9, column: 1 },
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
        2 | function foo() {
      > 3 |   return a + 2
          |   ^^^^^^^^^^^^
      > 4 | }
          | ^"
    `)
  })

  it(`shows the message next to the marker`, () => {
    expect(
      codeFrameColumns(
        source,
        { start: { line: 1, column: 7 } },
        { message: `Unexpected token`, linesBelow: 1 }
      )
    ).toMatchInlineSnapshot(`
      "> 1 | const a = 1
          |       ^ Unexpected token
        2 | function foo() {"
    `)
  })

  it(`shows the message above the frame when there is no column`, () => {
    expect(
      codeFrameColumns(
        source,
        { start: { line: 1 } },
        { message: `Unexpected token`, linesBelow: 1 }
      )
    ).toMatchInlineSnapshot(`
      "  Unexpected token
      > 1 | const a = 1
        2 | function foo() {"
    `)
  })
})

describe(`fromBabelPosition`, () => {
  // Babel のパーサーや AST の位置は、列を 0 から数える
  it(`points at the character of a 0-based column`, () => {
    // 1 行目の `a` は、0 始まりで 6 列目にある
    expect(
      codeFrameColumns(source, {
        start: fromBabelPosition({ line: 1, column: 6 }),
      })
    ).toMatchInlineSnapshot(`
      "> 1 | const a = 1
          |       ^
        2 | function foo() {
        3 |   return a + 2
        4 | }"
    `)
  })

  it(`points at the first character for column 0`, () => {
    expect(
      codeFrameColumns(source, {
        start: fromBabelPosition({ line: 2, column: 0 }),
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
      > 2 | function foo() {
          | ^
        3 |   return a + 2
        4 | }"
    `)
  })

  it(`marks a range between 0-based columns`, () => {
    // 3 行目の `a + 2` は、0 始まりで 9 列目から 14 列目の手前までにある
    expect(
      codeFrameColumns(source, {
        start: fromBabelPosition({ line: 3, column: 9 }),
        end: fromBabelPosition({ line: 3, column: 14 }),
      })
    ).toMatchInlineSnapshot(`
      "  1 | const a = 1
        2 | function foo() {
      > 3 |   return a + 2
          |          ^^^^^
        4 | }"
    `)
  })
})
