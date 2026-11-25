const fs = require(`fs-extra`)
const _ = require(`lodash`)
const { getMonorepoPackageJsonPath } = require(
  `./get-monorepo-package-json-path`
)
const { default: got } = require(`got`)

function difference(object, base) {
  function changes(object, base) {
    return _.transform(object, function (result, value, key) {
      if (!_.isEqual(value, base[key])) {
        result[key] =
          _.isObject(value) && _.isObject(base[key])
            ? changes(value, base[key])
            : value
      }
    })
  }
  return changes(object, base)
}

/**
 * インストール済みのパッケージとモノレポのパッケージの依存を比較する。
 * モノレポのパッケージで削除された依存はスキップする。
 *
 * ローカルにパッケージがインストールされていない場合は、unpkg.com を確認する。
 * これにより、gatsby-dev は不要な公開を省き、何も変わっていなければ
 * 公開の npm リポジトリからパッケージをインストールさせることができる。
 */
exports.checkDepsChanges = async ({
  newPath,
  packageName,
  monoRepoPackages,
  isInitialScan,
  ignoredPackageJSON,
  packageNameToPath,
}) => {
  let localPKGjson
  let packageNotInstalled = false
  try {
    localPKGjson = JSON.parse(fs.readFileSync(newPath, `utf-8`))
  } catch {
    packageNotInstalled = true
    // ローカルにパッケージがないので、依存のインストールはやはり必要である
    // 開発者が最初のパッケージのインストールをしなくて済み、こちらで処理できるので都合がよい。
    if (!isInitialScan) {
      console.log(
        `'${packageName}' doesn't seem to be installed. Restart gatsby-dev to publish it`
      )
      return {
        didDepsChanged: false,
        packageNotInstalled,
      }
    }

    // パッケージがインストールされていない場合は、unkpg へ http の GET リクエストを送り、
    // 公開の npm リポジトリにあるパッケージの依存が
    // 異なるかどうかを調べる

    // これにより、ローカルリポジトリへの公開を省き、
    // 時間と手間を節約できる
    try {
      const version = getPackageVersion(packageName)
      const url = `https://unpkg.com/${packageName}@${version}/package.json`
      const response = await got(url)
      if (response?.statusCode !== 200) {
        throw new Error(`No response or non 200 code for ${url}`)
      }
      localPKGjson = JSON.parse(response.body)
    } catch (e) {
      console.log(
        `'${packageName}' doesn't seem to be installed and is not published on NPM. Error: ${e.message}`
      )
      return {
        didDepsChanged: true,
        packageNotInstalled,
      }
    }
  }

  const monoRepoPackageJsonPath = getMonorepoPackageJsonPath({
    packageName,
    packageNameToPath,
  })
  const monorepoPKGjsonString = fs.readFileSync(
    monoRepoPackageJsonPath,
    `utf-8`
  )
  const monorepoPKGjson = JSON.parse(monorepoPKGjsonString)
  if (ignoredPackageJSON.has(packageName)) {
    if (ignoredPackageJSON.get(packageName).includes(monorepoPKGjsonString)) {
      // 公開の途中であり、package.json の内容は公開処理の中で設定されたものなので、
      // 誤検出を起こさないようにする必要がある
      return {
        didDepsChanged: false,
        packageNotInstalled,
      }
    }
  }

  if (!monorepoPKGjson.dependencies) monorepoPKGjson.dependencies = {}
  if (!localPKGjson.dependencies) localPKGjson.dependencies = {}

  const areDepsEqual = _.isEqual(
    monorepoPKGjson.dependencies,
    localPKGjson.dependencies
  )

  if (!areDepsEqual) {
    const diff = difference(
      monorepoPKGjson.dependencies,
      localPKGjson.dependencies
    )

    const diff2 = difference(
      localPKGjson.dependencies,
      monorepoPKGjson.dependencies
    )

    let needPublishing = false
    let isPublishing = false
    const depChangeLog = _.uniq(Object.keys({ ...diff, ...diff2 }))
      .reduce((acc, key) => {
        if (monorepoPKGjson.dependencies[key] === `gatsby-dev`) {
          // ローカルリポジトリへの公開の途中であれば無視する
          isPublishing = true
          return acc
        }

        if (localPKGjson.dependencies[key] === `gatsby-dev`) {
          // モノレポのパッケージはバージョンを元に戻すが、ローカルのサイトへ
          // インストールした後は `gatsby-dev` の dist タグが使われる。その変更は
          // 無視する必要がある
          return acc
        }

        if (
          localPKGjson.dependencies[key] &&
          monorepoPKGjson.dependencies[key]
        ) {
          // gatsby リポジトリ以外のパッケージについてだけ、
          // バージョンの変更を確認する。
          // gatsby のパッケージの変更はモノレポからコピーされ、
          // そこにほかの依存の変更が含まれていれば、
          // それも対象になる
          if (!monoRepoPackages.includes(key)) {
            acc.push(
              ` - '${key}' changed version from ${localPKGjson.dependencies[key]} to ${monorepoPKGjson.dependencies[key]}`
            )
            needPublishing = true
          }
        } else if (monorepoPKGjson.dependencies[key]) {
          acc.push(` - '${key}@${monorepoPKGjson.dependencies[key]}' was added`)
          needPublishing = true
        } else {
          acc.push(` - '${key}@${localPKGjson.dependencies[key]}' was removed`)
          // これは実際には公開する必要がないので、スキップする
        }
        return acc
      }, [])
      .join(`\n`)

    if (!isPublishing && depChangeLog.length > 0) {
      console.log(`Dependencies of '${packageName}' changed:\n${depChangeLog}`)
      if (isInitialScan) {
        console.log(
          `Will ${!needPublishing ? `not ` : ``}publish to local npm registry.`
        )
      } else {
        console.warn(
          `Installation of dependencies after initial scan is not implemented`
        )
      }
      return {
        didDepsChanged: needPublishing,
        packageNotInstalled,
      }
    }
  }
  return {
    didDepsChanged: false,
    packageNotInstalled,
  }
}

function getPackageVersion(packageName) {
  const projectPackageJson = JSON.parse(
    fs.readFileSync(`./package.json`, `utf-8`)
  )
  const { dependencies = {}, devDependencies = {} } = projectPackageJson
  const version = dependencies[packageName] || devDependencies[packageName]
  return version || `latest`
}
