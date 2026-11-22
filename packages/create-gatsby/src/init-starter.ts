import { execSync } from "child_process"
import execa, { Options } from "execa"
import fs from "fs-extra"
import path from "path"
import { reporter } from "./utils/reporter"
import { spin } from "tiny-spin"
import { getConfigStore } from "./utils/get-config-store"
type PackageManager = "yarn" | "npm"
import colors from "ansi-colors"
import { clearLine } from "./utils/clear-line"

const packageManagerConfigKey = `cli.packageManager`

export const getPackageManager = (
  npmConfigUserAgent?: string
): PackageManager => {
  const configStore = getConfigStore()
  const actualPackageManager = configStore.get(packageManagerConfigKey)

  if (actualPackageManager) {
    return actualPackageManager
  }

  if (npmConfigUserAgent?.includes(`yarn`)) {
    configStore.set(packageManagerConfigKey, `yarn`)
    return `yarn`
  }

  configStore.set(packageManagerConfigKey, `npm`)
  return `npm`
}

// yarn パッケージが存在するかを調べる
// Hadoop の yarn との衝突を避けるため、yarn ではなく yarnpkg を使う
// https://github.com/yarnpkg/yarn/issues/673 を参照
const checkForYarn = (): boolean => {
  try {
    execSync(`yarnpkg --version`, { stdio: `ignore` })
    return true
  } catch (e) {
    reporter.info(
      `Woops! You have chosen "yarn" as your package manager, but it doesn't seem be installed on your machine. You can install it from https://yarnpkg.com/getting-started/install or change your preferred package manager with the command "gatsby options set pm npm". As a fallback, we will run the next steps with npm.`
    )
    return false
  }
}

// クローンしたばかりのディレクトリを git リポジトリとして初期化する
const gitInit = async (
  rootPath: string
): Promise<execa.ExecaReturnBase<string>> =>
  await execa(`git`, [`init`], { cwd: rootPath })

// 新しいディレクトリに .gitignore ファイルがなければ作成する
const maybeCreateGitIgnore = async (rootPath: string): Promise<void> => {
  if (fs.existsSync(path.join(rootPath, `.gitignore`))) {
    return
  }

  await fs.writeFile(
    path.join(rootPath, `.gitignore`),
    `.cache\nnode_modules\npublic\n`
  )
}

// 新しいディレクトリで最初の git コミットを作成する
const createInitialGitCommit = async (rootPath: string): Promise<void> => {
  await execa(`git`, [`add`, `-A`], { cwd: rootPath })
  // （パスワード付きの）pgp 署名を使う git クライアントに対応するため、
  // spawn ではなく execSync を使う
  try {
    execSync(`git commit -m "Initial commit from gatsby"`, {
      cwd: rootPath,
    })
  } catch {
    // 最初のコミットに失敗した場合は、git の設定を取り除く
    reporter.info(`Initial git commit failed - removing git support\n`)
    fs.removeSync(path.join(rootPath, `.git`))
  }
}

const setNameInPackage = async (
  sitePath: string,
  npmSafeSiteName: string
): Promise<void> => {
  const packageJsonPath = path.join(sitePath, `package.json`)
  const packageJson = await fs.readJSON(packageJsonPath)
  packageJson.name = npmSafeSiteName
  packageJson.description = npmSafeSiteName
  delete packageJson.license
  try {
    const result = await execa(`git`, [`config`, `user.name`])
    if (result.failed) {
      delete packageJson.author
    } else {
      packageJson.author = result.stdout
    }
  } catch (e) {
    delete packageJson.author
  }

  await fs.writeJSON(packageJsonPath, packageJson, { spaces: 2 })
}

// rootPath で `npm install` または `yarn install` を実行する。
const install = async (
  rootPath: string,
  packages: Array<string>
): Promise<void> => {
  const prevDir = process.cwd()

  reporter.info(
    `${colors.blueBright(colors.symbols.pointer)} Installing Gatsby...`
  )

  process.chdir(rootPath)

  const npmConfigUserAgent = process.env.npm_config_user_agent

  try {
    const pm = getPackageManager(npmConfigUserAgent)

    const options: Options = {
      stderr: `inherit`,
    }

    const npmAdditionalCliArgs = [
      `--loglevel`,
      `error`,
      `--color`,
      `always`,
      `--legacy-peer-deps`,
      `--no-audit`,
    ]

    if (pm === `yarn` && checkForYarn()) {
      const args = packages.length
        ? [`add`, `--silent`, ...packages]
        : [`--silent`]

      await fs.remove(`package-lock.json`)
      await execa(`yarnpkg`, args, options)
    } else {
      await fs.remove(`yarn.lock`)
      await execa(`npm`, [`install`, ...npmAdditionalCliArgs], options)
      await clearLine()

      reporter.success(`Installed Gatsby`)
      reporter.info(
        `${colors.blueBright(colors.symbols.pointer)} Installing plugins...`
      )

      await execa(
        `npm`,
        [`install`, ...npmAdditionalCliArgs, ...packages],
        options
      )
      await clearLine()
    }

    reporter.success(`Installed plugins`)
  } catch (e) {
    reporter.panic((e as Error).message)
  } finally {
    process.chdir(prevDir)
  }
}

// URI からスターターをクローンする。
const clone = async (
  url: string,
  rootPath: string,
  branch?: string
): Promise<void> => {
  const branchProps = branch ? [`-b`, branch] : []
  const stop = spin(`Cloning site template`)
  const args = [
    `clone`,
    ...branchProps,
    url,
    rootPath,
    `--recursive`,
    `--depth=1`,
    `--quiet`,
  ].filter(arg => Boolean(arg))

  try {
    await execa(`git`, args)

    reporter.success(`Created site from template`)
  } catch (err) {
    reporter.panic((err as Error).message)
  }

  stop()
  await fs.remove(path.join(rootPath, `.git`))

  await fs.remove(path.join(rootPath, `LICENSE`))
}

export async function gitSetup(rootPath: string): Promise<void> {
  await gitInit(rootPath)
  await maybeCreateGitIgnore(rootPath)
  await createInitialGitCommit(rootPath)
}

/**
 * スターターをクローンまたはコピーするメインの関数。
 */
export async function initStarter(
  starter: string,
  rootPath: string,
  packages: Array<string>,
  npmSafeSiteName: string
): Promise<void> {
  const sitePath = path.resolve(rootPath)

  await clone(starter, sitePath)

  await setNameInPackage(sitePath, npmSafeSiteName)

  await install(rootPath, packages)

  // trackCli(`NEW_PROJECT_END`);
}
