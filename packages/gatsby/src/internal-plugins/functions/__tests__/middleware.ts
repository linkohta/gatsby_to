import type { RequestHandler } from "express"
import { functionMiddlewares } from "../middleware"

// `functionMiddlewares` の先頭が cookie を解析するミドルウェアである
function runCookieMiddleware(cookieHeader?: string): {
  cookies: Record<string, string | undefined> | undefined
  next: jest.Mock
} {
  const [setCookies] = functionMiddlewares({
    getFunctions: () => [],
  }) as Array<RequestHandler>
  const req = { headers: { cookie: cookieHeader } } as any
  const next = jest.fn()

  setCookies(req, {} as any, next)

  return { cookies: req.cookies, next }
}

describe(`functions middleware: cookies`, () => {
  it(`does not set req.cookies without a Cookie header`, () => {
    const { cookies, next } = runCookieMiddleware()

    expect(cookies).toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it(`parses the Cookie header into req.cookies`, () => {
    const { cookies, next } = runCookieMiddleware(
      `session=abc%20def; theme=dark; json=%7B%22a%22%3A1%7D`
    )

    expect({ ...cookies }).toEqual({
      session: `abc def`,
      theme: `dark`,
      json: `{"a":1}`,
    })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it(`keeps the first value of a repeated name`, () => {
    const { cookies } = runCookieMiddleware(`id=1; id=2`)

    expect({ ...cookies }).toEqual({ id: `1` })
  })

  // cookie 1.0 以降の動作。引用符は値の一部として残る
  it(`keeps the quotes of a quoted value`, () => {
    const { cookies } = runCookieMiddleware(`x="quoted"`)

    expect({ ...cookies }).toEqual({ x: `"quoted"` })
  })

  // cookie 0.7 以降の動作。`Object.prototype` を継承しないオブジェクトを返すため、
  // `hasOwnProperty` などのメソッドは使えない
  it(`returns an object that does not inherit from Object.prototype`, () => {
    const { cookies } = runCookieMiddleware(`a=1; __proto__=x`)

    expect(`hasOwnProperty` in (cookies as Record<string, unknown>)).toBe(false)
    expect(Object.keys(cookies as Record<string, unknown>)).toEqual([
      `a`,
      `__proto__`,
    ])
  })
})
