const { runServer } = require(`verdaccio`)

const fs = require(`fs-extra`)
const _ = require(`lodash`)

let VerdaccioInitPromise = null

const { verdaccioConfig } = require(`./verdaccio-config`)
const { publishPackage } = require(`./publish-package`)
const { installPackages } = require(`./install-packages`)

const startServer = () => {
  if (VerdaccioInitPromise) {
    return VerdaccioInitPromise
  }

  console.log(`Starting local verdaccio server`)

  // ストレージを消去する
  fs.removeSync(verdaccioConfig.storage)

  VerdaccioInitPromise = runServer(verdaccioConfig).then(
    webServer =>
      new Promise(resolve => {
        webServer.listen(verdaccioConfig.port, `localhost`, () => {
          console.log(`Started local verdaccio server`)

          resolve()
        })
      })
  )

  return VerdaccioInitPromise
}

exports.startVerdaccio = startServer

exports.publishPackagesLocallyAndInstall = async ({
  packagesToPublish,
  localPackages,
  packageNameToPath,
  ignorePackageJSONChanges,
  yarnWorkspaceRoot,
  externalRegistry,
  root,
  packageManager,
}) => {
  await startServer()

  const versionPostFix = Date.now()

  const newlyPublishedPackageVersions = {}

  for (const packageName of packagesToPublish) {
    newlyPublishedPackageVersions[packageName] = await publishPackage({
      packageName,
      packagesToPublish,
      packageNameToPath,
      versionPostFix,
      ignorePackageJSONChanges,
      root,
    })
  }

  const packagesToInstall = _.intersection(packagesToPublish, localPackages)

  await installPackages({
    packagesToInstall,
    yarnWorkspaceRoot,
    newlyPublishedPackageVersions,
    externalRegistry,
    packageManager,
  })
}
