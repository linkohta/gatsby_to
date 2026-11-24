import type { LoaderContext } from "webpack"
import cssUrlAssetLoader from "../css-url-asset-loader"

const run = (source: string | Buffer): string | Buffer | void =>
  cssUrlAssetLoader.call({} as LoaderContext<unknown>, source)

describe(`css-url-asset-loader`, () => {
  it(`rewrites the output of url-loader`, () => {
    expect(run(`export default "data:image/png;base64,AAAA"`)).toBe(
      `module.exports = "data:image/png;base64,AAAA"`
    )
  })

  it(`rewrites the output of file-loader`, () => {
    expect(
      run(`export default __webpack_public_path__ + "static/image-123.png";`)
    ).toBe(`module.exports = __webpack_public_path__ + "static/image-123.png";`)
  })

  it(`leaves other sources as they are`, () => {
    const commonJs = `module.exports = "static/image-123.png"`
    expect(run(commonJs)).toBe(commonJs)

    const buffer = Buffer.from(`export default "x"`)
    expect(run(buffer)).toBe(buffer)
  })
})
