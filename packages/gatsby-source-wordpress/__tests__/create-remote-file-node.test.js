import http from "http"
import os from "os"
import path from "path"
import fs from "fs-extra"
import createRemoteFileNode from "../dist/steps/source-nodes/create-nodes/create-remote-file-node"
import { createStore, asyncLocalStorage } from "../dist/store"

// 1x1 ピクセルの PNG
const png = Buffer.from(
  `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==`,
  `base64`
)

describe(`create-remote-file-node`, () => {
  let server
  let baseUrl
  let cacheDir

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === `/media/unknown`) {
        res.writeHead(200, { "Content-Type": `application/octet-stream` })
        res.end(Buffer.from(`not a known file type`))
      } else {
        res.writeHead(200, { "Content-Type": `application/octet-stream` })
        res.end(png)
      }
    })
    await new Promise(resolve => server.listen(0, `127.0.0.1`, resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
    cacheDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `gatsby-source-wordpress-`)
    )
  })

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.remove(cacheDir)
  })

  const download = url => {
    const values = new Map()
    const cache = {
      directory: cacheDir,
      get: async key => values.get(key),
      set: async (key, value) => values.set(key, value),
    }
    const progress = { start: jest.fn(), tick: jest.fn(), done: jest.fn() }

    return asyncLocalStorage.run({ store: createStore(), key: `test` }, () =>
      createRemoteFileNode({
        url,
        cache,
        createNode: jest.fn(),
        createNodeId: jest.fn(() => `file-node-id`),
        reporter: { createProgress: () => progress },
      })
    )
  }

  it(`guesses the extension from the file content when the url has none`, async () => {
    const node = await download(`${baseUrl}/media/image`)

    expect(node.ext).toBe(`.png`)
    expect(node.base).toBe(`image.png`)
    expect(await fs.readFile(node.absolutePath)).toEqual(png)
  })

  it(`keeps the file without an extension when the type is unknown`, async () => {
    const node = await download(`${baseUrl}/media/unknown`)

    expect(node.ext).toBe(``)
    expect(node.base).toBe(`unknown`)
  })

  it(`keeps the extension of the url`, async () => {
    const node = await download(`${baseUrl}/media/photo.jpg`)

    expect(node.base).toBe(`photo.jpg`)
  })
})
