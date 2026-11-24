import http from "http"
import type { AddressInfo } from "net"
import express from "express"
import { FUNCTIONS_ROUTE } from "../middleware"

describe(`functions middleware: route`, () => {
  let server: http.Server
  let baseUrl: string

  const get = async (
    url: string
  ): Promise<{ status: number; body: Record<string, unknown> | undefined }> => {
    const response = await fetch(baseUrl + url)
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : undefined,
    }
  }

  beforeAll(async () => {
    const app = express()
    app.use(FUNCTIONS_ROUTE, (req, res) => {
      res.json({ params: req.params, baseUrl: req.baseUrl })
    })

    server = await new Promise<http.Server>(resolve => {
      const listening = app.listen(0, `127.0.0.1`, () => resolve(listening))
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  // express 4 の `/api/*` と同じ結果になることを確認する
  it(`puts the path after /api/ in req.params[0]`, async () => {
    expect(await get(`/api/hello`)).toEqual({
      status: 200,
      body: { params: { "0": `hello` }, baseUrl: `/api/hello` },
    })
    expect(await get(`/api/users/1?x=1`)).toEqual({
      status: 200,
      body: { params: { "0": `users/1` }, baseUrl: `/api/users/1` },
    })
    expect(await get(`/api/`)).toEqual({
      status: 200,
      body: { params: { "0": `` }, baseUrl: `/api` },
    })
  })

  it(`matches case-insensitively`, async () => {
    expect((await get(`/API/hello`)).body).toEqual({
      params: { "0": `hello` },
      baseUrl: `/API/hello`,
    })
  })

  it(`does not match other paths`, async () => {
    expect((await get(`/api`)).status).toBe(404)
    expect((await get(`/apix/hello`)).status).toBe(404)
    expect((await get(`/prefix/api/hello`)).status).toBe(404)
  })
})
