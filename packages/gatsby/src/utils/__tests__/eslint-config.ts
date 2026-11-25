import fs from "fs"
import os from "os"
import path from "path"
import { ESLint } from "eslint"
import { slash } from "gatsby-core-utils"
import { store } from "../../redux"
import { eslintConfig, eslintRequiredConfig } from "../eslint-config"

// 利用者のサイトに見立てた一時ディレクトリを、ESLint と Babel の作業ディレクトリにしてリントする。
// リポジトリを作業ディレクトリにすると、@babel/eslint-parser がリポジトリのビルド用の
// Babel 設定（ルートの `.babelrc.js`）を読み込み、利用者のサイトとは違う結果になるためである。
// `process.chdir()` を使わないのは、Jest がソースを変換するときの Babel プラグインが
// 作業ディレクトリからモジュールを探すためである。
// Flow の構文は gatsby-plugin-flow を使うサイトと同じく、サイトの Babel 設定で有効にする
const siteDir = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), `gatsby-eslint-config-`))
)
fs.writeFileSync(path.join(siteDir, `package.json`), `{}`)
// リポジトリのルートには別のツールが使う Babel 7 向けの @babel/preset-flow があるので、
// gatsby-plugin-flow が依存しているものを使う
const flowPreset = require.resolve(`@babel/preset-flow`, {
  paths: [path.dirname(require.resolve(`gatsby-plugin-flow/package.json`))],
})
fs.writeFileSync(
  path.join(siteDir, `.babelrc`),
  JSON.stringify({ presets: [flowPreset] })
)
const pagePath = path.join(siteDir, `src`, `pages`, `index.js`)
const componentPath = path.join(siteDir, `src`, `components`, `a.jsx`)

function inSite(options: ESLint.Options): ESLint.Options {
  return {
    ...options,
    cwd: siteDir,
    overrideConfig: {
      languageOptions: {
        parserOptions: { babelOptions: { cwd: siteDir } },
      },
    },
  }
}

async function lint(
  options: ESLint.Options & { emitWarning?: boolean },
  code: string,
  filePath: string
): Promise<Array<string>> {
  // `emitWarning` は eslint-webpack-plugin のオプションで、ESLint には渡せない
  const { emitWarning: _emitWarning, ...eslintOptions } = options
  const eslint = new ESLint(inSite(eslintOptions))
  const [result] = await eslint.lintText(code, { filePath })

  return result.messages.map(message => `${message.severity} ${message.ruleId}`)
}

const page = `
import React from "react"
export const helper = 1
export default () => <a href="#">{window.x == 1}</a>
`

describe(`eslint-config`, () => {
  beforeAll(() => {
    // ページテンプレート向けのルールは、ストアに登録されたコンポーネントだけを対象にする
    store.getState().components.set(slash(pagePath), {} as never)
  })

  afterAll(() => {
    store.getState().components.delete(slash(pagePath))
    fs.rmSync(siteDir, { recursive: true, force: true })
  })

  it(`reports the bundled rules`, async () => {
    const messages = await lint(eslintConfig(false), page, pagePath)

    expect(messages.sort()).toEqual([
      `1 eqeqeq`,
      `1 gatsby/limited-exports-page-templates`,
      `1 gatsby/no-anonymous-exports-page-templates`,
      `1 import/no-anonymous-default-export`,
      `1 jsx-a11y/anchor-is-valid`,
    ])
  })

  it(`parses flow and jsx, and knows the graphql global`, async () => {
    const messages = await lint(
      eslintConfig(false),
      `
import React, { useState } from "react"
type A = B
export function Widget({ on }) {
  if (on) {
    useState(0)
  }
  return <img src={graphql} data-a={(1: A)} />
}
`,
      componentPath
    )

    expect(messages.sort()).toEqual([
      `1 jsx-a11y/alt-text`,
      `2 react-hooks/rules-of-hooks`,
    ])
  })

  it(`requires React in scope only with the classic runtime`, async () => {
    const code = `export const A = () => <div />\n`

    expect(await lint(eslintConfig(false), code, componentPath)).toEqual([
      `2 react/react-in-jsx-scope`,
    ])
    expect(await lint(eslintConfig(true), code, componentPath)).toEqual([])
  })

  it(`reports only the required rules with the required config`, async () => {
    const messages = await lint(eslintRequiredConfig, page, pagePath)

    expect(messages.sort()).toEqual([
      `1 gatsby/limited-exports-page-templates`,
      `1 gatsby/no-anonymous-exports-page-templates`,
    ])
  })

  it(`ignores inline config with the required config`, async () => {
    const messages = await lint(
      eslintRequiredConfig,
      `/* eslint-disable */\n${page}`,
      pagePath
    )

    expect(messages).toHaveLength(2)
  })

  it(`ignores files in dot directories`, async () => {
    const { emitWarning: _emitWarning, ...options } = eslintRequiredConfig
    const eslint = new ESLint(inSite(options))

    expect(
      await eslint.isPathIgnored(path.join(siteDir, `.cache`, `app.js`))
    ).toBe(true)
    expect(await eslint.isPathIgnored(pagePath)).toBe(false)
  })
})
