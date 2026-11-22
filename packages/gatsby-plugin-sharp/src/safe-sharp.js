// かなり強引な方法だが、"sharp" を peerDependency にするまでの
// 一時的な回避策であり、その後は削除できる。
// まだそうしていないのは、影響が大きすぎるためである。
// 画像処理は Gatsby のエコシステムの重要な部分であり、
// こちらで管理していないガイドやチュートリアルが数多くあって、
// それらが古くなってしまう。"sharp" を peerDependency へ
// 移すのは gatsby@3 で予定している。

// このファイルは、このリポジトリ内の複数の場所に複製されている。
// 変更するときは、すべての "safe-sharp" ファイルに同じ変更を加えること。

const childProcess = require(`child_process`)
const path = require(`path`)
const fs = require(`fs`)
const semver = require(`semver`)

const originalConsoleError = console.error
const restoreConsoleError = () => {
  console.error = originalConsoleError
}

const getDetailedMessage = () => {
  try {
    // `npm list` は、package-lock.json がなければ yarn でインストールした
    // プロジェクトでも動作するようである。そのため、両方のロックファイルが
    // ある場合は処理を打ち切る

    if (
      fs.existsSync(path.join(process.cwd(), `package-lock.json`)) &&
      fs.existsSync(path.join(process.cwd(), `yarn.lock`))
    ) {
      return null
    }

    let msg = []
    const { dependencies } = JSON.parse(
      childProcess.execSync(`npm list sharp --json`, {
        encoding: `utf-8`,
      })
    )

    const findSharpVersion = dependency => {
      if (dependency.dependencies.sharp) {
        return dependency.dependencies.sharp.version
      }

      for (const depName of Object.keys(dependency.dependencies)) {
        const v = findSharpVersion(dependency.dependencies[depName])
        if (v) {
          return v
        }
      }

      return null
    }

    const { latestVersion, topLevelPackages } = Object.keys(
      dependencies
    ).reduce(
      (acc, depName) => {
        const sharpVersion = findSharpVersion(dependencies[depName])
        if (sharpVersion) {
          acc.topLevelPackages[depName] = sharpVersion

          if (
            !acc.latestVersion ||
            semver.gt(sharpVersion, acc.latestVersion)
          ) {
            acc.latestVersion = sharpVersion
          }
        }

        return acc
      },
      {
        latestVersion: undefined,
        topLevelPackages: {},
      }
    )

    const packagesToUpdate = []
    // トップレベルの依存を一覧する
    msg = msg.concat([
      `List of installed packages that depend on sharp:`,
      ...Object.keys(topLevelPackages).map(depName => {
        const sharpVersion = topLevelPackages[depName]
        if (sharpVersion !== latestVersion) {
          packagesToUpdate.push(depName)
        }
        return ` - ${depName}${
          sharpVersion
            ? ` (${sharpVersion})${
                sharpVersion !== latestVersion ? ` - needs update` : ``
              }`
            : ``
        }`
      }),
    ])

    if (packagesToUpdate.length > 0) {
      msg = msg.concat([
        ``,
        `If you are using npm, run:`,
        ``,
        `npm install ${packagesToUpdate.join(` `)}`,
        ``,
        `If you are using yarn, run:`,
        ``,
        `yarn add ${packagesToUpdate.join(` `)}`,
      ])
    }

    return msg
    // eslint-disable-next-line no-empty
  } catch {
    return null
  }
}

const handleMessage = msg => {
  if (msg.includes(`Incompatible library version: sharp.node requires`)) {
    restoreConsoleError()

    let msg = [
      `It looks like there are multiple versions of "sharp" module installed.`,
      `Please update any packages that depend on "sharp".`,
      ``,
    ]

    const detailedMessage = getDetailedMessage()
    if (!detailedMessage) {
      msg = msg.concat([
        `To get a list of installed packages that depend on "sharp" try running:`,
        ` - npm list sharp (if you use npm)`,
        ` - yarn why sharp (if you use yarn)`,
        ` and update packages that depend on version older than latest listed in output of above command.`,
      ])
    } else {
      msg = msg.concat(detailedMessage)
    }

    msg = msg.concat([
      ``,
      `If an older version of "sharp" still persists and this error is displayed after updating your packages, open an issue in the package's repository and request them to update the "sharp" dependency.`,
    ])

    console.error(msg.join(`\n`))
  }
}

let sharp
try {
  // sharp@0.22.1 は throw せずに、console.error を呼んでから process.exit する
  // そのため、エラーを捕捉して意味のあるトラブルシューティングの案内を出せるよう、
  // console.error の呼び出しを横取りして特別な処理を加えている。
  console.error = (msg, ...args) => {
    originalConsoleError(msg, ...args)
    handleMessage(msg)
  }
  sharp = require(`sharp`)
} catch (e) {
  handleMessage(e.toString())
  throw e
} finally {
  restoreConsoleError()
}

module.exports = sharp
