const fs = require(`fs-extra`)
const path = require(`path`)

const { promisifiedSpawn } = require(`../utils/promisified-spawn`)
const { registryUrl } = require(`./verdaccio-config`)

const NPMRCContent = `${registryUrl.replace(
  /https?:/g,
  ``
)}/:_authToken="gatsby-dev"`

const {
  getMonorepoPackageJsonPath,
} = require(`../utils/get-monorepo-package-json-path`)
const { registerCleanupTask } = require(`./cleanup-tasks`)

const DEPENDENCY_FIELDS = [`dependencies`, `optionalDependencies`]

/**
 * package.json を次のように編集する:
 *  - バージョンを一時的なものに変更する
 *  - 公開される依存のバージョン指定を変更し、
 *    yarn がローカルのサイトにそれらを
 *    インストールするようにする
 */
const adjustPackageJson = ({
  monoRepoPackageJsonPath,
  packageName,
  versionPostFix,
  packagesToPublish,
  ignorePackageJSONChanges,
  packageNameToPath,
}) => {
  // このパッケージが、公開されるほかのパッケージに依存しているかを調べ、
  // バージョン指定をそのパッケージの開発版に向け直して、依存にローカルレジストリが
  // 使われるようにする必要がある。

  const monorepoPKGjsonString = fs.readFileSync(
    monoRepoPackageJsonPath,
    `utf-8`
  )
  const monorepoPKGjson = JSON.parse(monorepoPKGjsonString)

  monorepoPKGjson.version = `${monorepoPKGjson.version}-dev-${versionPostFix}`
  packagesToPublish.forEach(packageThatWillBePublished => {
    // ここでは `optionalDependencies` も `dependencies` と同じくらい重要である。まだ npm に
    // ないバージョンを指したままの範囲（リリース PR の場合など）は、ローカルレジストリからも
    // 満たせない。そこへ公開するのは `-dev-` のプレリリースであり、キャレット範囲は
    // プレリリースに一致しないためである。
    const fieldsToAdjust = DEPENDENCY_FIELDS.filter(
      field =>
        monorepoPKGjson[field] &&
        monorepoPKGjson[field][packageThatWillBePublished]
    )

    if (fieldsToAdjust.length === 0) {
      return
    }

    const currentVersion = JSON.parse(
      fs.readFileSync(
        getMonorepoPackageJsonPath({
          packageName: packageThatWillBePublished,
          packageNameToPath,
        }),
        `utf-8`
      )
    ).version

    for (const field of fieldsToAdjust) {
      monorepoPKGjson[field][
        packageThatWillBePublished
      ] = `${currentVersion}-dev-${versionPostFix}`
    }
  })

  const temporaryMonorepoPKGjsonString = JSON.stringify(monorepoPKGjson)

  const unignorePackageJSONChanges = ignorePackageJSONChanges(packageName, [
    monorepoPKGjsonString,
    temporaryMonorepoPKGjsonString,
  ])

  // バージョンと依存のバージョンを変更する
  fs.outputFileSync(monoRepoPackageJsonPath, temporaryMonorepoPKGjsonString)

  return {
    newPackageVersion: monorepoPKGjson.version,
    unadjustPackageJson: registerCleanupTask(() => {
      // 元の package.json を復元する
      fs.outputFileSync(monoRepoPackageJsonPath, monorepoPKGjsonString)
      unignorePackageJSONChanges()
    }),
  }
}

/**
 * 匿名での公開にはダミーの .npmrc が必要である
 * https://github.com/verdaccio/verdaccio/issues/212#issuecomment-308578500 を参照
 * これは（リンク先のコメントにあるとおり）`npm publish` と `yarn publish` の要件であり、
 * verdaccio の制約ではない。
 */
const createTemporaryNPMRC = ({ pathToPackage, root }) => {
  const NPMRCPathInPackage = path.join(pathToPackage, `.npmrc`)
  fs.outputFileSync(NPMRCPathInPackage, NPMRCContent)

  const NPMRCPathInRoot = path.join(root, `.npmrc`)
  fs.outputFileSync(NPMRCPathInRoot, NPMRCContent)

  return registerCleanupTask(() => {
    fs.removeSync(NPMRCPathInPackage)
    fs.removeSync(NPMRCPathInRoot)
  })
}

const publishPackage = async ({
  packageName,
  packagesToPublish,
  versionPostFix,
  ignorePackageJSONChanges,
  packageNameToPath,
  root,
}) => {
  const monoRepoPackageJsonPath = getMonorepoPackageJsonPath({
    packageName,
    packageNameToPath,
  })

  const { unadjustPackageJson, newPackageVersion } = adjustPackageJson({
    monoRepoPackageJsonPath,
    packageName,
    packageNameToPath,
    versionPostFix,
    packagesToPublish,
    ignorePackageJSONChanges,
  })

  const pathToPackage = path.dirname(monoRepoPackageJsonPath)

  const uncreateTemporaryNPMRC = createTemporaryNPMRC({ pathToPackage, root })

  // npm publish
  const publishCmd = [
    `npm`,
    [`publish`, `--tag`, `gatsby-dev`, `--registry=${registryUrl}`],
    {
      cwd: pathToPackage,
    },
  ]

  console.log(
    `Publishing ${packageName}@${newPackageVersion} to local registry`
  )
  try {
    await promisifiedSpawn(publishCmd)

    console.log(
      `Published ${packageName}@${newPackageVersion} to local registry`
    )
  } catch (e) {
    console.error(`Failed to publish ${packageName}@${newPackageVersion}`, e)
    process.exit(1)
  }

  uncreateTemporaryNPMRC()
  unadjustPackageJson()

  return newPackageVersion
}

exports.publishPackage = publishPackage
