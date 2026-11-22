// @ts-check
import { maskText, formatPluginOptionsForCLI } from "../plugin-options"

// テストでは出力の色付けを無効にする
process.env.FORCE_COLOR = `0`

const maskedCharacterCount = input =>
  input.split(``).filter(char => char === `*`).length

describe(`Mask text`, () => {
  it.each([
    [`handles very short inputs`, `a`, `*`],
    [`handles short inputs`, `abcd`, `***d`],
    [
      `handles long inputs`,
      `abcdefghijklmnopqrstuvwxyz`,
      `**********************wxyz`,
    ],
  ])(`%s`, (_, input, expectedResult) => {
    const result = maskText(input)

    // 結果を明示的に確認する
    expect(result).toEqual(expectedResult)

    // 文字列の長さが同じである
    expect(result.length).toEqual(input.length)
    // 入力の 75% 以上を隠す
    expect(maskedCharacterCount(result)).toBeGreaterThanOrEqual(
      input.length * 0.75
    )
    // 表示するのは最大 4 文字
    expect(result.length - maskedCharacterCount(result)).toBeLessThanOrEqual(4)
  })
})

describe(`Formatting plugin options for CLI`, () => {
  it(`kitchen sink`, () => {
    const options = {
      accessToken: `abcdefghijklmnopqrstuvwxyz`,
      spaceId: `abcdefgh`,
      host: `wat`,
      localeFilter: locale => locale.code === `de`,
    }
    const annotations = {
      spaceId: `foo`,
      environment: `bar`,
    }
    const result = formatPluginOptionsForCLI(options, annotations)

    const lines = result.split(`\n`)

    // プラグインオプションを一覧表示するときに秘密情報が漏れない
    expect(result).toContain(`accessToken`)
    expect(result).not.toContain(options.accessToken)
    expect(result).toContain(`spaceId`)
    expect(result).not.toContain(options.spaceId)

    // デフォルト値が使われている場合は印を付ける
    expect(lines.find(line => line.includes(`downloadLocal`))).toContain(
      `default value`
    )
    expect(lines.find(line => line.includes(`useNameForId`))).toContain(
      `default value`
    )
    expect(lines.find(line => line.includes(`environment`))).toContain(
      `default value`
    )

    // 注釈が追加される
    expect(lines.find(line => line.includes(`spaceId`))).toContain(
      annotations.spaceId
    )
    expect(lines.find(line => line.includes(`environment`))).toContain(
      annotations.environment
    )
  })
})
