// かなり強引な方法だが、"sharp" を peerDependency にするまでの
// 一時的な回避策であり、その後は削除できる。
// まだそうしていないのは、影響が大きすぎるためである。
// 画像処理は Gatsby のエコシステムの重要な部分であり、
// こちらで管理していないガイドやチュートリアルが数多くあって、
// それらが古くなってしまう。"sharp" を peerDependency へ
// 移すのは gatsby@3 で予定している。

// 以前は、"sharp" を使う各プラグインがこのファイルの複製を持っていた。
// "sharp" は各プラグイン自身の依存から解決する必要があるので、
// 読み込む処理は呼び出し側から関数で受け取る。

import * as childProcess from "child_process"
import * as path from "path"
import * as fs from "fs"
import semver from "semver"

interface INpmListEntry {
  version?: string
  dependencies?: Record<string, INpmListEntry>
}

interface ISharpVersions {
  latestVersion: string | undefined
  topLevelPackages: Record<string, string>
}

const getDetailedMessage = (): Array<string> | null => {
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

    let msg: Array<string> = []
    const { dependencies } = JSON.parse(
      childProcess.execSync(`npm list sharp --json`, {
        encoding: `utf-8`,
      })
    )

    const findSharpVersion = (dependency: INpmListEntry): string | null => {
      // 依存を持たない項目では、これまでと同じく TypeError になり、外側の catch で null を返す
      const nested = dependency.dependencies as Record<string, INpmListEntry>
      if (nested.sharp) {
        return nested.sharp.version as string
      }

      for (const depName of Object.keys(nested)) {
        const v = findSharpVersion(nested[depName])
        if (v) {
          return v
        }
      }

      return null
    }

    const { latestVersion, topLevelPackages } = Object.keys(
      dependencies
    ).reduce(
      (acc: ISharpVersions, depName) => {
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

    const packagesToUpdate: Array<string> = []
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

const handleMessage = (msg: string, restoreConsoleError: () => void): void => {
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

/**
 * "sharp" を読み込み、複数のバージョンが入っていて読み込めないときは、対処方法を表示する。
 * @param load "sharp" を読み込んで返す関数。呼び出し側のパッケージから解決するために受け取る
 */
export function loadSharpSafely<T>(load: () => T): T {
  const originalConsoleError = console.error
  const restoreConsoleError = (): void => {
    console.error = originalConsoleError
  }

  try {
    // sharp@0.22.1 は throw せずに、console.error を呼んでから process.exit する
    // そのため、エラーを捕捉して意味のあるトラブルシューティングの案内を出せるよう、
    // console.error の呼び出しを横取りして特別な処理を加えている。
    console.error = (msg, ...args): void => {
      originalConsoleError(msg, ...args)
      handleMessage(msg as string, restoreConsoleError)
    }
    return load()
  } catch (e) {
    handleMessage(e.toString(), restoreConsoleError)
    throw e
  } finally {
    restoreConsoleError()
  }
}
