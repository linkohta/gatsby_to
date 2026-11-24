import * as path from "path"
import * as os from "os"
import * as fs from "fs-extra"
import http from "http"
import type { AddressInfo } from "net"
import express from "express"
import { developStatic } from "../develop-static"

describe(`developStatic`, () => {
  let root: string
  let server: http.Server
  let baseUrl: string

  const getStatus = async (url: string): Promise<number> =>
    (await fetch(baseUrl + url)).status

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), `develop-static-`))
    await fs.outputFile(path.join(root, `app.js`), `// app`)
    await fs.outputFile(path.join(root, `index.html`), `<html></html>`)
    await fs.outputFile(path.join(root, `.hidden`), `hidden`)
    await fs.outputFile(path.join(root, `sub`, `.hidden`), `hidden`)
    await fs.outputFile(path.join(root, `.well-known`, `security.txt`), `ok`)

    const app = express()
    app.use(developStatic(root, { index: false }))
    app.use((_req, res) => {
      res.status(418).end()
    })

    server = await new Promise<http.Server>(resolve => {
      const listening = app.listen(0, `127.0.0.1`, () => resolve(listening))
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.remove(root)
  })

  it(`serves files`, async () => {
    const response = await fetch(`${baseUrl}/app.js`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(`// app`)
  })

  it(`leaves html files to the next handler`, async () => {
    expect(await getStatus(`/index.html`)).toBe(418)
  })

  // express 4 の既定の動作を保っている（express 5 の既定では、どちらも配信されない）
  it(`serves files inside a directory whose name starts with a dot`, async () => {
    const response = await fetch(`${baseUrl}/.well-known/security.txt`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(`ok`)
  })

  it(`does not serve files whose name starts with a dot`, async () => {
    expect(await getStatus(`/.hidden`)).toBe(418)
    expect(await getStatus(`/sub/.hidden`)).toBe(418)
  })
})
