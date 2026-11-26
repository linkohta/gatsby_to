const fs = require(`fs-extra`)
const path = require(`path`)

const { promisifiedSpawn } = require(`../utils/promisified-spawn`)
const { registryUrl } = require(`./verdaccio-config`)

const registryUser = { name: `gatsby-dev`, password: `gatsby-dev` }

let authTokenPromise = null

/**
 * ローカルレジストリにユーザーを登録し、公開に使うトークンを取得する。
 * verdaccio 7 以降は、無効なトークンが付いたリクエストを匿名として扱わずに 401 で拒否するため、
 * ダミーのトークンでは公開できない。レジストリは起動のたびに作り直すので、最初の公開の前に 1 回だけ登録する。
 */
const getRegistryAuthToken = () => {
  if (!authTokenPromise) {
    authTokenPromise = fetch(
      `${registryUrl}/-/user/org.couchdb.user:${registryUser.name}`,
      {
        method: `PUT`,
        headers: { "Content-Type": `application/json` },
        body: JSON.stringify(registryUser),
      }
    ).then(async response => {
      const body = await response.json()
      if (!response.ok || !body.token) {
        throw new Error(
          `Failed to register a user on the local registry: ${response.status} ${JSON.stringify(body)}`
        )
      }
      return body.token
    })
  }

  return authTokenPromise
}

exports.getRegistryAuthToken = getRegistryAuthToken

const getNPMRCContent = authToken =>
  `${registryUrl.replace(/https?:/g, ``)}/:_authToken="${authToken}"`

const { getMonorepoPackageJsonPath } = require(
  `../utils/get-monorepo-package-json-path`
)
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
      monorepoPKGjson[field][packageThatWillBePublished] =
        `${currentVersion}-dev-${versionPostFix}`
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
 * `npm publish` と `yarn publish` は認証情報がないと実行できないので、
 * ローカルレジストリのトークンを書いた .npmrc を一時的に置く
 */
const createTemporaryNPMRC = ({ pathToPackage, root, authToken }) => {
  const NPMRCContent = getNPMRCContent(authToken)
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
  // package.json を書き換える前に取得する。取得に失敗しても、ファイルを元に戻す必要がないようにするためである
  const authToken = await getRegistryAuthToken()

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

  const uncreateTemporaryNPMRC = createTemporaryNPMRC({
    pathToPackage,
    root,
    authToken,
  })

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
