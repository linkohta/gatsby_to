// cache-dir を、利用者のサイトと同じ Babel 7 と babel-preset-gatsby でコンパイルし、
// 結果を標準出力に書き出す。@babel/cli を使わないのは、リポジトリのビルド用の
// @babel/cli が Babel 8 で、Babel 7 向けの babel-preset-gatsby を読み込めないためである。
// Node.js から直接実行するスクリプトなので JavaScript で書いている
//
// 使い方: node compile-cache-dir.js <コンパイルするディレクトリ> <Babel の設定ファイル>
const fs = require(`fs`)
const path = require(`path`)

// gatsby の dependencies に入っている @babel/core（利用者のサイトで使われるもの）を読み込む
const babel = require(require.resolve(`@babel/core`, { paths: [__dirname] }))

const [srcDir, configFile] = process.argv.slice(2)

function compileDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // @babel/cli の `--ignore **/__tests__` と同じく、テストは対象にしない
      if (entry.name !== `__tests__`) {
        compileDir(fullPath)
      }
    } else if (babel.DEFAULT_EXTENSIONS.includes(path.extname(entry.name))) {
      const { code } = babel.transformFileSync(fullPath, { configFile })
      process.stdout.write(`${code}\n`)
    }
  }
}

compileDir(srcDir)
