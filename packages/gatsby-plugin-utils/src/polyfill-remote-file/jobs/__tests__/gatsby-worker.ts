import path from "path"
import fs from "fs-extra"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { IMAGE_CDN } from "../gatsby-worker"
import getSharpInstance from "gatsby-sharp"

const server = setupServer(
  http.get(`https://example.com/another-file.jpg`, async () => {
    const content = await fs.readFile(
      path.join(__dirname, `../../__tests__/__fixtures__/dog-portrait.jpg`)
    )

    return new HttpResponse(content, {
      status: 200,
      headers: {
        [`Content-Type`]: `image/jpg`,
        [`Content-Length`]: content.length.toString(),
      },
    })
  })
)

describe(`gatsby-worker`, () => {
  beforeAll(() => server.listen())
  afterAll(() => server.close())

  describe(`IMAGE_CDN`, () => {
    // TODO msw が CI では不可解なエラーで失敗するが、ローカルでは失敗しない
    it.skip(`should download and transform an image`, async () => {
      const outputDir = path.join(__dirname, `.cache`)
      await IMAGE_CDN({
        outputDir,
        args: {
          contentDigest: `1`,
          filename: `abc.jpg`,
          format: `jpg`,
          height: 100,
          width: 100,
          quality: 80,
          url: `https://example.com/another-file.jpg`,
        },
      })

      const outputFile = path.join(outputDir, `abc.jpg`)
      expect(await fs.pathExists(outputFile)).toBe(true)

      const sharp = await getSharpInstance()
      const metadata = await sharp(outputFile).metadata()
      expect(metadata.width).toBe(100)
      expect(metadata.height).toBe(100)

      await fs.remove(outputFile)
    })
  })
})
