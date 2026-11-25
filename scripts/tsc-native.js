// TypeScript 7（ネイティブ版）の tsc を実行する。
//
// typescript パッケージは、コンパイラの API を必要とするツール（typescript-eslint や microbundle）のために
// 6 系のままにしている。7 系は typescript-native という別名で入れてあるが、どちらも tsc という名前の
// 実行ファイルを持つので、node_modules/.bin/tsc がどちらを指すかはあてにできない。
// 型チェックと型定義の出力で 7 系を確実に使うために、このスクリプトを経由する。
const path = require(`path`)
const { spawnSync } = require(`child_process`)

const packageJsonPath = require.resolve(`typescript-native/package.json`)
const tscPath = path.resolve(
  path.dirname(packageJsonPath),
  require(packageJsonPath).bin.tsc
)

const result = spawnSync(
  process.execPath,
  [tscPath, ...process.argv.slice(2)],
  {
    stdio: `inherit`,
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status === null ? 1 : result.status)
