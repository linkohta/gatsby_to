const path = require(`path`)
const fs = require(`fs-extra`)

const { promisifiedSpawn } = require(`../utils/promisified-spawn`)
const { registryUrl } = require(`./verdaccio-config`)

const installPackages = async ({
  packagesToInstall,
  yarnWorkspaceRoot,
  newlyPublishedPackageVersions,
  externalRegistry,
  packageManager,
}) => {
  console.log(
    `Installing packages from local registry:\n${packagesToInstall
      .map(packageAndVersion => ` - ${packageAndVersion}`)
      .join(`\n`)}`
  )
  let installCmd
  if (yarnWorkspaceRoot) {
    // これはかなり強引な方法である。root を受け取って `yarn workspaces info` を実行し、
    // すべてのワークスペースとその場所の一覧を取得する。そして、インストールしたい
    // パッケージの package.json ファイルを手動で編集し、ワークスペース内で
    // 同じパッケージのバージョンが食い違わないようにする。
    // これで node_modules の構造が保たれるはずである
    // （パッケージの大部分がトップレベルの node_modules に巻き上げられる）

    const { stdout } = await promisifiedSpawn([
      `yarn`,
      [`workspaces`, `info`, `--json`],
      { stdio: `pipe` },
    ])

    let workspacesLayout
    try {
      workspacesLayout = JSON.parse(JSON.parse(stdout).data)
    } catch (e) {
      /*
      Yarn 1.22 は純粋な json を出力せず、前後にテキストが付く:
      ```
      $ yarn workspaces info --json
      yarn workspaces v1.22.0
      {
        "z": {
          "location": "z",
          "workspaceDependencies": [],
          "mismatchedWorkspaceDependencies": []
        },
        "y": {
          "location": "y",
          "workspaceDependencies": [],
          "mismatchedWorkspaceDependencies": []
        }
      }
      Done in 0.48s.
      ```
      そのため、整形が必要になる。`{` で始まり `}` で終わる部分文字列に
      一致させて JSON を取り出す
    */

      const regex = /^[^{]*({.*})[^}]*$/gs
      const sanitizedStdOut = regex.exec(stdout)
      if (sanitizedStdOut?.length >= 2) {
        // 最初の（唯一の）キャプチャーグループの内容を取り出す
        const jsonString = sanitizedStdOut[1]
        try {
          workspacesLayout = JSON.parse(jsonString)
        } catch (e) {
          console.error(
            `Failed to parse "sanitized" output of "yarn workspaces info" command.\n\nSanitized string: "${jsonString}`
          )
          // ここでは終了しない。下に `workspacesLayout` が設定されているかの全体的な確認があるため
        }
      }
    }

    if (!workspacesLayout) {
      console.error(
        `Couldn't parse output of "yarn workspaces info" command`,
        stdout
      )
      process.exit(1)
    }

    const handleDeps = deps => {
      if (!deps) {
        return false
      }

      let changed = false
      Object.keys(deps).forEach(depName => {
        if (packagesToInstall.includes(depName)) {
          deps[depName] = `gatsby-dev`
          changed = true
        }
      })
      return changed
    }

    Object.keys(workspacesLayout).forEach(workspaceName => {
      const { location } = workspacesLayout[workspaceName]
      const pkgJsonPath = path.join(yarnWorkspaceRoot, location, `package.json`)
      if (!fs.existsSync(pkgJsonPath)) {
        return
      }
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, `utf8`))

      let changed = false
      changed |= handleDeps(pkg.dependencies)
      changed |= handleDeps(pkg.devDependencies)
      changed |= handleDeps(pkg.peerDependencies)

      if (changed) {
        console.log(`Changing deps in ${pkgJsonPath} to use @gatsby-dev`)
        fs.outputJSONSync(pkgJsonPath, pkg, {
          spaces: 2,
        })
      }
    })

    // package.json ファイルが変更されているので、verdaccio レジストリを使って
    // インストールするだけでよい
    const yarnCommands = [`install`]

    if (!externalRegistry) {
      yarnCommands.push(`--registry=${registryUrl}`)
    }

    installCmd = [`yarn`, yarnCommands]
  } else {
    const packageAndVersionsToInstall = packagesToInstall.map(packageName => {
      const packageVersion = newlyPublishedPackageVersions[packageName]
      return `${packageName}@${packageVersion}`
    })

    if (packageManager === `pnpm`) {
      const pnpmCommands = [
        `add`,
        ...packageAndVersionsToInstall,
        `--save-exact`,
      ]

      if (!externalRegistry) {
        pnpmCommands.push(`--registry=${registryUrl}`)
      }

      installCmd = [`pnpm`, pnpmCommands]
    } else {
      const yarnCommands = [`add`, ...packageAndVersionsToInstall, `--exact`]

      if (!externalRegistry) {
        yarnCommands.push(`--registry=${registryUrl}`)
      }

      installCmd = [`yarn`, yarnCommands]
    }
  }

  try {
    await promisifiedSpawn(installCmd)

    console.log(`Installation complete`)
  } catch (error) {
    console.error(`Installation failed`, error)
    process.exit(1)
  }
}

exports.installPackages = installPackages
