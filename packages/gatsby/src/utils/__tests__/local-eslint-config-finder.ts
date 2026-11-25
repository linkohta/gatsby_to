import * as path from "path"
import * as os from "os"
import * as fs from "fs-extra"
import { hasLocalEslint } from "../local-eslint-config-finder"

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {
    error: jest.fn(),
  }
})

describe(`hasLocalEslint`, () => {
  let directory: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), `gatsby-eslint-`))
    await fs.writeJson(path.join(directory, `package.json`), { name: `site` })
  })

  afterEach(async () => {
    await fs.remove(directory)
  })

  it(`returns false when the site has no ESLint config`, () => {
    expect(hasLocalEslint(directory)).toBe(false)
  })

  it(`detects eslintConfig in package.json`, async () => {
    await fs.writeJson(path.join(directory, `package.json`), {
      name: `site`,
      eslintConfig: {},
    })

    expect(hasLocalEslint(directory)).toBe(true)
  })

  it.each([
    `.eslintrc`,
    `.eslintrc.js`,
    `.eslintrc.json`,
    `.eslintrc.yaml`,
    `.eslintrc.yml`,
    `eslint.config.js`,
    `eslint.config.mjs`,
    `eslint.config.cjs`,
    `eslint.config.ts`,
    `eslint.config.mts`,
    `eslint.config.cts`,
  ])(`detects %s`, async file => {
    await fs.writeFile(path.join(directory, file), ``)

    expect(hasLocalEslint(directory)).toBe(true)
  })

  it(`ignores files with a similar name`, async () => {
    await fs.writeFile(path.join(directory, `eslint.config.json`), ``)
    await fs.writeFile(path.join(directory, `my-eslint.config.js`), ``)

    expect(hasLocalEslint(directory)).toBe(false)
  })
})
