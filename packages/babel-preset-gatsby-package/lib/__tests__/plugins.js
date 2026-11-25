const fs = require(`fs`)
const path = require(`path`)
const { execFileSync } = require(`child_process`)

// Babel 8 は ESM 専用で、Jest のサンドボックスの中からは読み込めない。
// @babel/helper-plugin-test-runner も使えないので、フィクスチャの変換は別のプロセスで実行する。
//
// fixtures の下のディレクトリがスイートで、その下のディレクトリがケースである。
// スイートの options.js が Babel のオプションで、ケースは input.js を変換した結果を
// output.js（または output.mjs）と比べる。options.json に throws があるケースは、
// そのメッセージのエラーになることを確かめる
const fixturesDir = path.join(__dirname, `fixtures`)
const runBabel = path.join(fixturesDir, `run-babel.js`)

const listDirectories = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

const transform = (suiteDir, caseDir) =>
  JSON.parse(
    execFileSync(process.execPath, [runBabel, suiteDir, caseDir], {
      encoding: `utf8`,
      // keep-dynamic-import の options.js は、リポジトリのルートからの相対パスを使う
      cwd: path.join(__dirname, `..`, `..`, `..`, `..`),
      stdio: [`ignore`, `pipe`, `ignore`],
    })
  )

describe.each(listDirectories(fixturesDir))(`%s`, suite => {
  const suiteDir = path.join(fixturesDir, suite)

  it.each(listDirectories(suiteDir))(`%s`, testCase => {
    const caseDir = path.join(suiteDir, testCase)
    const result = transform(suiteDir, caseDir)

    const optionsPath = path.join(caseDir, `options.json`)
    const { throws } = fs.existsSync(optionsPath)
      ? JSON.parse(fs.readFileSync(optionsPath, `utf8`))
      : {}

    if (throws) {
      expect(result.error).toContain(throws)
      return
    }

    const outputPath = [`output.js`, `output.mjs`]
      .map(name => path.join(caseDir, name))
      .find(file => fs.existsSync(file))

    expect(result.error).toBeUndefined()
    expect(result.code.trim()).toBe(fs.readFileSync(outputPath, `utf8`).trim())
  })
})
