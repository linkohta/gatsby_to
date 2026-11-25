// フィクスチャを 1 つ変換して、結果を JSON で標準出力に書く。
// 使い方: node run-babel.js <スイートのディレクトリ> <ケースのディレクトリ>
const fs = require(`fs`)
const path = require(`path`)
const babel = require(`@babel/core`)

const [suiteDir, caseDir] = process.argv.slice(2)

const options = { ...require(path.join(suiteDir, `options.js`)) }

const caseOptionsPath = path.join(caseDir, `options.json`)
if (fs.existsSync(caseOptionsPath)) {
  // throws は期待するエラーメッセージで、Babel のオプションではない
  const { throws: _throws, ...caseOptions } = JSON.parse(
    fs.readFileSync(caseOptionsPath, `utf8`)
  )
  Object.assign(options, caseOptions)
}

const filename = path.join(caseDir, `input.js`)

let result
try {
  const { code } = babel.transformSync(fs.readFileSync(filename, `utf8`), {
    ...options,
    filename,
  })
  result = { code }
} catch (error) {
  result = { error: error.message }
}

process.stdout.write(JSON.stringify(result))
