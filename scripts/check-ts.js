// This file runs the typescript checker against packages.
// you can run it against all:
//   `node ./scripts/check-ts`
//
// or even scope it to specific packages.
//   `node ./scripts/check-ts gatsby-cli`
"use strict"

const fs = require(`fs`)
const glob = require(`glob`)
const path = require(`path`)
// chalk 5 以降は ESM のみで、require すると default に chalk が入ったモジュールが返る
const { default: chalk } = require(`chalk`)
// yargs 18 の require はインスタンスではなくファクトリー関数を返すので、解析する引数を渡して作る
const { hideBin } = require(`yargs/helpers`)
const yargs = require(`yargs`)(hideBin(process.argv))
const { execaSync } = require(`execa`)

console.log(`TS Check: Running...`)

const toAbsolutePath = relativePath => path.join(__dirname, `..`, relativePath)
const PACKAGES_DIR = toAbsolutePath(`/packages`)

const filterPackage = yargs.argv._[0]

const packages = fs
  .readdirSync(PACKAGES_DIR)
  .map(file => path.resolve(PACKAGES_DIR, file))
  .filter(f => fs.lstatSync(path.resolve(f)).isDirectory())

// We only want to typecheck against packages that have a tsconfig.json
// AND have some ts files in it's source code.
let packagesWithTs = packages
  .filter(p => fs.existsSync(path.resolve(p, `tsconfig.json`)))
  .filter(
    project =>
      glob.sync(`/**/*.ts`, {
        root: project,
        ignore: `**/node_modules/**`,
      }).length
  )

if (filterPackage) {
  packagesWithTs = packagesWithTs.filter(project =>
    project.endsWith(filterPackage)
  )

  if (packagesWithTs.length === 0) {
    console.log()
    console.error(chalk.red(`Error:`))
    console.log(
      chalk.red(
        `A package matching "${filterPackage}" did not find a package with TypeScript enabled.`
      )
    )
    console.log(
      chalk.red(
        `Make sure that package exists at "/packages/${filterPackage}" and has a tsconfig.json file`
      )
    )
    console.log()
    process.exit(1)
  }
}

let totalTsFiles = 0
let totalJsFiles = 0

packagesWithTs.forEach(project => {
  const tsFiles = glob.sync(
    toAbsolutePath(
      `./packages/${project.split(/.*packages[/\\]/)[1]}/src/**/*.ts`
    )
  ).length

  const jsFiles = glob.sync(
    toAbsolutePath(
      `./packages/${project.split(/.*packages[/\\]/)[1]}/src/**/*.js`
    )
  ).length

  totalTsFiles += tsFiles
  totalJsFiles += jsFiles

  const percentConverted = Number(
    ((tsFiles / (jsFiles + tsFiles)) * 100).toFixed(1)
  )

  console.log(
    `TS Check: Checking ./packages/${project.split(/.*packages[/\\]/)[1]}`,
    `\n  - TS Files: ${tsFiles}`,
    `\n  - JS Files: ${jsFiles}`,
    `\n  - Percent Converted: ${percentConverted}%`
  )

  // 型チェックには TypeScript 7（ネイティブ版）を使う
  const args = [
    path.join(__dirname, `tsc-native.js`),
    `-p`,
    project,
    `--noEmit`,
  ]

  try {
    execaSync(`node`, args, { stdio: `inherit` })
  } catch (e) {
    process.exit(1)
  }
})

console.log(`TS Check: Success`)

if (!filterPackage) {
  const percentConverted = Number(
    ((totalTsFiles / (totalJsFiles + totalTsFiles)) * 100).toFixed(1)
  )

  console.log(
    `  - Total TS Files: ${totalJsFiles}`,
    `\n  - Total JS Files: ${totalJsFiles}`,
    `\n  - Percent Converted: ${percentConverted}%`
  )
}
