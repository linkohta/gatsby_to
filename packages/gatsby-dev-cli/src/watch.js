const chokidar = require(`chokidar`)
const _ = require(`lodash`)
const del = require(`del`)
const fs = require(`fs-extra`)
const path = require(`path`)
const findWorkspaceRoot = require(`find-yarn-workspace-root`)

const { publishPackagesLocallyAndInstall } = require(`./local-npm-registry`)
const { checkDepsChanges } = require(`./utils/check-deps-changes`)
const { getDependantPackages } = require(`./utils/get-dependant-packages`)
const {
  setDefaultSpawnStdio,
  promisifiedSpawn,
} = require(`./utils/promisified-spawn`)
const { traversePackagesDeps } = require(`./utils/traverse-package-deps`)

let numCopied = 0

const quit = () => {
  console.log(`Copied ${numCopied} files`)
  process.exit()
}

const MAX_COPY_RETRIES = 3

/*
 * 存在しないパッケージがあると on('ready') が動かなくなる
 * 参照: https://github.com/paulmillr/chokidar/issues/449
 */
async function watch(
  root,
  packages,
  {
    scanOnce,
    quiet,
    forceInstall,
    monoRepoPackages,
    localPackages,
    packageNameToPath,
    externalRegistry,
    packageManager,
  }
) {
  setDefaultSpawnStdio(quiet ? `ignore` : `inherit`)
  // yarn workspace の中かどうかを判定する。workspace の中であれば verdaccio の使用を強制する。
  // 現在のファイルコピーの処理は正しく動かないためである。
  const yarnWorkspaceRoot = findWorkspaceRoot()
  if (yarnWorkspaceRoot && process.env.NODE_ENV !== `test`) {
    console.log(`Yarn workspace found.`)
    forceInstall = true
  }

  let afterPackageInstallation = false
  let queuedCopies = []

  const realCopyPath = arg => {
    const { oldPath, newPath, quiet, resolve, reject, retry = 0 } = arg
    fs.copy(oldPath, newPath, err => {
      if (err) {
        if (retry >= MAX_COPY_RETRIES) {
          console.error(err)
          reject(err)
          return
        } else {
          setTimeout(
            () => realCopyPath({ ...arg, retry: retry + 1 }),
            500 * Math.pow(2, retry)
          )
          return
        }
      }

      // gatsby のバイナリをコピーしただけでは、yarn でインストールしたときに付く
      // 実行権限が設定されない。
      // ここでは、gatsby-dev の実行後に `yarn gatsby develop` を実行すると
      // 権限の問題で失敗する不具合を修正している。
      // @fixes https://github.com/gatsbyjs/gatsby/issues/18809
      // 対象のバイナリファイル:
      // - gatsby/bin/gatsby.js
      //  -gatsby/cli.js
      //  -gatsby-cli/cli.js
      if (/(bin\/gatsby.js|gatsby(-cli)?\/cli.js)$/.test(newPath)) {
        fs.chmodSync(newPath, `0755`)
      }

      numCopied += 1
      if (!quiet) {
        console.log(`Copied ${oldPath} to ${newPath}`)
      }
      resolve()
    })
  }

  const copyPath = (oldPath, newPath, quiet, packageName) =>
    new Promise((resolve, reject) => {
      const argObj = { oldPath, newPath, quiet, packageName, resolve, reject }
      if (afterPackageInstallation) {
        realCopyPath(argObj)
      } else {
        queuedCopies.push(argObj)
      }
    })

  const runQueuedCopies = () => {
    afterPackageInstallation = true
    queuedCopies.forEach(argObj => realCopyPath(argObj))
    queuedCopies = []
  }

  const clearJSFilesFromNodeModules = async () => {
    const packagesToClear = queuedCopies.reduce((acc, { packageName }) => {
      if (packageName) {
        acc.add(packageName)
      }
      return acc
    }, new Set())

    await Promise.all(
      [...packagesToClear].map(
        async packageToClear =>
          await del([
            `node_modules/${packageToClear}/**/*.{js,js.map}`,
            `!node_modules/${packageToClear}/node_modules/**/*.{js,js.map}`,
            `!node_modules/${packageToClear}/src/**/*.{js,js.map}`,
          ])
      )
    )
  }
  // パッケージの依存を調べ、モノレポのほかのパッケージに依存していれば
  // パッケージの一覧に追加する
  const { seenPackages, depTree } = traversePackagesDeps({
    root,
    packages: _.uniq(localPackages),
    monoRepoPackages,
    packageNameToPath,
  })

  const allPackagesToWatch = packages
    ? _.intersection(packages, seenPackages)
    : seenPackages

  const ignoredPackageJSON = new Map()
  const ignorePackageJSONChanges = (packageName, contentArray) => {
    ignoredPackageJSON.set(packageName, contentArray)

    return () => {
      ignoredPackageJSON.delete(packageName)
    }
  }

  if (forceInstall) {
    try {
      if (allPackagesToWatch.length > 0) {
        await publishPackagesLocallyAndInstall({
          packagesToPublish: allPackagesToWatch,
          packageNameToPath,
          localPackages,
          ignorePackageJSONChanges,
          yarnWorkspaceRoot,
          externalRegistry,
          root,
          packageManager,
        })
      } else {
        // `yarn` を実行する
        const yarnInstallCmd = [`yarn`]

        console.log(`Installing packages from public NPM registry`)
        await promisifiedSpawn(yarnInstallCmd)
        console.log(`Installation complete`)
      }
    } catch (e) {
      console.log(e)
    }

    process.exit()
  }

  if (allPackagesToWatch.length === 0) {
    console.error(`There are no packages to watch.`)
    return
  }

  const allPackagesIgnoringThemesToWatch = allPackagesToWatch.filter(
    pkgName => !pkgName.startsWith(`gatsby-theme`)
  )

  const ignored = [
    /[/\\]node_modules[/\\]/i,
    /\.git/i,
    /\.DS_Store/,
    /[/\\]__tests__[/\\]/i,
    /[/\\]__mocks__[/\\]/i,
    /\.npmrc/i,
  ].concat(
    allPackagesIgnoringThemesToWatch.map(
      p => new RegExp(`${p}[\\/\\\\]src[\\/\\\\]`, `i`)
    )
  )
  const watchers = _.uniq(
    allPackagesToWatch
      .map(p => path.join(packageNameToPath.get(p)))
      .filter(p => fs.existsSync(p))
  )

  let allCopies = []
  const packagesToPublish = new Set()
  let isInitialScan = true
  let isPublishing = false

  const waitFor = new Set()
  let anyPackageNotInstalled = false

  const watchEvents = [`change`, `add`]
  const packagePathMatchingEntries = Array.from(packageNameToPath.entries())
  chokidar
    .watch(watchers, {
      ignored: [filePath => _.some(ignored, reg => reg.test(filePath))],
    })
    .on(`all`, async (event, filePath) => {
      if (!watchEvents.includes(event)) {
        return
      }

      // パスと照合する
      let packageName

      for (const [_packageName, packagePath] of packagePathMatchingEntries) {
        const relativeToThisPackage = path.relative(packagePath, filePath)
        if (!relativeToThisPackage.startsWith(`..`)) {
          packageName = _packageName
          break
        }
      }

      if (!packageName) {
        return
      }

      const prefix = packageNameToPath.get(packageName)

      // ローカルのバージョンに上書きコピーする。
      // Gatsby の bin ファイルは上書きしない。NPM のシンボリックリンクが壊れるためである。
      if (_.includes(filePath, `dist/gatsby-cli.js`)) {
        return
      }

      const relativePackageFile = path.relative(prefix, filePath)

      const newPath = path.join(
        `./node_modules/${packageName}`,
        relativePackageFile
      )

      if (relativePackageFile === `package.json`) {
        // 公開の途中で、パッケージ（と依存）のバージョンを調整するために package.json ファイルが変更されるので、
        // その間の変更は無視する
        if (isPublishing) {
          return
        }

        // 依存をローカルのバージョンと比較する

        const didDepsChangedPromise = checkDepsChanges({
          newPath,
          packageName,
          monoRepoPackages,
          packageNameToPath,
          isInitialScan,
          ignoredPackageJSON,
        })

        if (isInitialScan) {
          // checkDepsChanges は通常なら同期的だが、
          // ローカルにパッケージがインストールされていない場合は
          // unpkg への非同期の GET リクエストも行うことがある
          // そのため、処理を記録しておき、インストールの前に
          // すべてが終わるようにする

          waitFor.add(didDepsChangedPromise)
        }

        const { didDepsChanged, packageNotInstalled } =
          await didDepsChangedPromise

        if (packageNotInstalled) {
          anyPackageNotInstalled = true
        }

        if (didDepsChanged) {
          if (isInitialScan) {
            waitFor.delete(didDepsChangedPromise)
            // 依存の変更を処理するのは最初のスキャンのときだけである。監視モードで正しく
            // 処理することももちろん可能だが、まずリリースすることを優先し、
            // 手間と時間のかかるエッジケースは対象から外している。

            // 依存が変更されたので、実際に公開する必要があるパッケージを
            // 特定しなければならない。
            // 依存が変更されたパッケージが、ほかの gatsby パッケージの依存である場合、
            // たとえば `gatsby-plugin-page-creator` であれば、
            // `gatsby-plugin-page-creator` と `gatsby` の両方を公開し、
            // サンプルサイトのプロジェクトに `gatsby` をインストールする必要がある。
            getDependantPackages({
              packageName,
              depTree,
              packages,
            }).forEach(packageToPublish => {
              // 公開を予約する。`ready` が発行されたときに公開すれば、
              // 1 回の公開で済むためである
              packagesToPublish.add(packageToPublish)
            })
          }
        }

        // package.json は決してコピーしない。以後の依存の変更の確認が
        // おかしくなるためである
        return
      }

      const localCopies = [copyPath(filePath, newPath, quiet, packageName)]

      // "cache-dir" のファイルであれば、サイトの .cache にもコピーする
      if (_.includes(filePath, `cache-dir`)) {
        const newCachePath = path.join(
          `.cache/`,
          path.relative(path.join(prefix, `cache-dir`), filePath)
        )
        localCopies.push(copyPath(filePath, newCachePath, quiet))
      }

      allCopies = allCopies.concat(localCopies)
    })
    .on(`ready`, async () => {
      // 公開とインストールの前に、必要な非同期の処理が
      // すべて終わるのを待つ
      await Promise.all(Array.from(waitFor))

      if (isInitialScan) {
        isInitialScan = false
        if (packagesToPublish.size > 0) {
          isPublishing = true
          await publishPackagesLocallyAndInstall({
            packagesToPublish: Array.from(packagesToPublish),
            packageNameToPath,
            localPackages,
            ignorePackageJSONChanges,
            externalRegistry,
            root,
            packageManager,
          })
          packagesToPublish.clear()
          isPublishing = false
        } else if (anyPackageNotInstalled) {
          // `yarn` を実行する
          const yarnInstallCmd = [`yarn`]

          console.log(`Installing packages from public NPM registry`)
          await promisifiedSpawn(yarnInstallCmd)
          console.log(`Installation complete`)
        }

        await clearJSFilesFromNodeModules()
        runQueuedCopies()
      }

      // すべてのファイルを監視し終えた。必要であれば、すべてのファイルのコピーが終わった時点で終了する
      Promise.all(allCopies).then(() => {
        if (scanOnce) {
          quit()
        }
      })
    })
}

module.exports = watch
