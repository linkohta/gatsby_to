const fs = require(`fs-extra`)
const os = require(`os`)
const path = require(`path`)
const { onPostBuild } = require(`../gatsby-node`)

jest.setTimeout(60000)

describe(`gatsby-plugin-subfont`, () => {
  let directory
  let reporter

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), `gatsby-subfont-`))
    reporter = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const publicDir = path.join(directory, `public`)
    await fs.copy(
      require.resolve(`fontverter/testdata/Roboto-400.woff2`),
      path.join(publicDir, `fonts`, `roboto.woff2`)
    )
    await fs.outputFile(
      path.join(publicDir, `styles.css`),
      `@font-face{font-family:Roboto;font-style:normal;font-weight:400;src:url(/fonts/roboto.woff2) format("woff2")} body{font-family:Roboto,sans-serif}`
    )
    await fs.outputFile(
      path.join(publicDir, `index.html`),
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>test</title><link rel="stylesheet" href="/styles.css"></head><body><h1>Hello Gatsby</h1></body></html>`
    )
  })

  afterEach(async () => {
    await fs.remove(directory)
  })

  it(`subsets the fonts used on the homepage and inlines them`, async () => {
    const store = {
      getState: () => {
        return { program: { directory } }
      },
    }

    await onPostBuild({ store, reporter }, {})

    const html = await fs.readFile(
      path.join(directory, `public`, `index.html`),
      `utf8`
    )

    // 使っている文字だけに切り詰めたフォントが、HTML に埋め込まれる
    expect(html).toContain(`font-family:Roboto__subset`)
    expect(html).toContain(`src:url(data:font/woff2;base64,`)
    expect(html).toContain(`unicode-range:`)
    // 元のフォントは、フォールバック用の CSS から読み込まれる
    expect(html).toMatch(
      /<link rel="stylesheet" href="\/subfont\/fallback-[0-9a-f]+\.css"/
    )
    expect(
      await fs.pathExists(
        path.join(directory, `public`, `fonts`, `roboto.woff2`)
      )
    ).toBe(true)
    expect(reporter.error).not.toHaveBeenCalled()
  })
})
