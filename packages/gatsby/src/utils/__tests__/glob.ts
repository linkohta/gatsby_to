import fs from "fs-extra"
import os from "os"
import path from "path"
import { slash } from "gatsby-core-utils"
import { glob, globSync } from "../glob"

describe(`glob`, () => {
  let root: string

  beforeAll(async () => {
    root = slash(
      await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), `gatsby-glob-`))
      )
    )

    await Promise.all(
      [
        `state_0`,
        `state_1`,
        `state_2`,
        `state_10`,
        `src/b.js`,
        `src/a.js`,
        `src/B.js`,
        `src/nested/c.ts`,
        `src/nested/c.test.ts`,
        `src/.hidden/d.js`,
        `linked/e.js`,
      ].map(file => fs.outputFile(path.join(root, file), file))
    )
    await fs.symlink(path.join(root, `linked`), path.join(root, `src/link`))
  })

  afterAll(async () => {
    await fs.remove(root)
  })

  it(`returns the matches in the order glob 7 returned them`, () => {
    expect(globSync(`${root}/state_*`)).toEqual([
      `${root}/state_0`,
      `${root}/state_1`,
      `${root}/state_10`,
      `${root}/state_2`,
    ])
    expect(globSync(`*.js`, { cwd: path.join(root, `src`) })).toEqual([
      `a.js`,
      `b.js`,
      `B.js`,
    ])
  })

  it(`does not return directories or links to directories with nodir`, () => {
    expect(globSync(`${root}/src/**`, { nodir: true })).toEqual([
      `${root}/src/a.js`,
      `${root}/src/b.js`,
      `${root}/src/B.js`,
      `${root}/src/nested/c.test.ts`,
      `${root}/src/nested/c.ts`,
    ])
    expect(
      globSync(`**/**`, { cwd: path.join(root, `src`), nodir: true, dot: true })
    ).toEqual([
      `.hidden/d.js`,
      `a.js`,
      `b.js`,
      `B.js`,
      `nested/c.test.ts`,
      `nested/c.ts`,
    ])
  })

  it(`returns directories without nodir`, () => {
    expect(globSync(`${root}/src/*`)).toEqual([
      `${root}/src/a.js`,
      `${root}/src/b.js`,
      `${root}/src/B.js`,
      `${root}/src/link`,
      `${root}/src/nested`,
    ])
  })

  it(`returns the same matches asynchronously and applies ignore patterns`, async () => {
    await expect(
      glob(`${root}/src/**/*.{js,ts}`, {
        ignore: [`${root}/src/**/+(*.)+(spec|test).+(js|ts)`],
      })
    ).resolves.toEqual([
      `${root}/src/a.js`,
      `${root}/src/b.js`,
      `${root}/src/B.js`,
      `${root}/src/link/e.js`,
      `${root}/src/nested/c.ts`,
    ])
  })

  it(`returns an empty array when nothing matches`, () => {
    expect(globSync(`${root}/missing/**`, { nodir: true })).toEqual([])
  })
})
