import { babelParseToAst } from "../babel-parse-to-ast"

describe(`babelParseToAst`, () => {
  it.each([
    [`Flow in .js`, `page.js`, `const add = (a: number): number => a + 1`],
    [`JSX in .js`, `page.js`, `export default () => <div>Hello</div>`],
    [`JSX in .tsx`, `page.tsx`, `export default () => <div>Hello</div>`],
    [
      `a generic arrow function with a trailing comma in .tsx`,
      `page.tsx`,
      `export const identity = <T,>(value: T): T => value`,
    ],
    [
      `a generic arrow function in .ts`,
      `utils.ts`,
      `export const identity = <T>(value: T): T => value`,
    ],
    [
      `a type assertion with angle brackets in .ts`,
      `utils.ts`,
      `export const value = <string>(input as unknown)`,
    ],
    // `.ts` に JSX を書くのは TypeScript としては誤りだが、Babel 7 のときから解釈できていた
    [
      `JSX in .ts`,
      `page.ts`,
      `const data = useStaticQuery<Query>(query)\nexport default () => <div>{data}</div>`,
    ],
    [
      `class fields and optional chaining`,
      `page.js`,
      `class A { #count = 0; static name = "a"; get(b) { return b?.c ?? this.#count } }`,
    ],
    [`decorators`, `page.js`, `@decorator class A {}`],
    [`the pipeline operator`, `page.js`, `const result = value |> double`],
  ])(`parses %s`, (_label, filePath, code) => {
    expect(babelParseToAst(code, filePath).program.body.length).toBeGreaterThan(
      0
    )
  })

  it(`throws a syntax error for invalid TypeScript`, () => {
    expect(() => babelParseToAst(`const = 1`, `utils.ts`)).toThrow(SyntaxError)
  })
})
