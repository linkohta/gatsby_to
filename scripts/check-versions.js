const { writeFileSync } = require(`fs`)
// yargs 18 の require はインスタンスではなくファクトリー関数を返すので、解析する引数を渡して作る
const { hideBin } = require(`yargs/helpers`)
const yargs = require(`yargs`)(hideBin(process.argv))
const semver = require(`semver`)
const { getPackages, getLocalDependencies } = require(
  `./utils/workspace-packages`
)

let warned = false
const argv = yargs
  .option(`fix`, {
    default: false,
    describe: `Fixes outdated dependencies`,
  })
  .option(`allow-next`, {
    default: false,
    describe: `Allow using "next" versions. Use this only for alpha/beta releases`,
  }).argv

const packages = getPackages(process.cwd())
const versions = new Map(packages.map(pkg => [pkg.name, pkg.version]))
const localDependencies = getLocalDependencies(packages)

packages.forEach(pkg => {
  let outdated = localDependencies
    .get(pkg.name)
    .filter(
      localDep => !semver.satisfies(versions.get(localDep.name), localDep.spec)
    )

  if (argv[`allow-next`]) {
    outdated = outdated.filter(localDep => localDep.spec !== `next`)
  }

  if (!outdated.length) return

  const msg = outdated
    .map(
      p =>
        `  Depends on "${p.name}@${p.spec}" \n` +
        `  instead of "${p.name}@${versions.get(p.name)}". \n`
    )
    .join(`\n`)

  console.error(`${pkg.name}: \n${msg}`)
  warned = true

  if (argv.fix) {
    const next = pkg.toJSON()
    const depTypes = [`dependencies`, `devDependencies`, `peerDependencies`]
    outdated.forEach(p => {
      depTypes.forEach(depKey => {
        if (next[depKey] && next[depKey][p.name]) {
          next[depKey][p.name] = `^${versions.get(p.name)}`
        }
      })
    })

    writeFileSync(`${pkg.location}/package.json`, JSON.stringify(next, null, 2))
  }
})

if (warned) {
  process.exit(1)
}
