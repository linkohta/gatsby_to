import path from "path"
import { pathToFileURL } from "url"
import report from "gatsby-cli/lib/reporter"

/**
 * Windows では、パスを正しく解決するために file プロトコルが必要である。
 * 他のプラットフォームでは必須ではないが対応しているので、常に使うようにしたい。
 * ただし jest はこれでは動作しないので、その環境では file プロトコルを付けない。
 */
export const maybeAddFileProtocol = process.env.JEST_WORKER_ID
  ? (module: string): string => module
  : (module: string): string => pathToFileURL(module).href

/**
 * fs モジュールに頼らずに、ファイルパスが .js か .mjs かを判定し、存在する場合はそのファイルパスを返す。
 */
export async function resolveJSFilepath({
  rootDir,
  filePath,
  warn = true,
}: {
  rootDir: string
  filePath: string
  warn?: boolean
}): Promise<string> {
  const filePathWithJSExtension = filePath.endsWith(`.js`)
    ? filePath
    : `${filePath}.js`
  const filePathWithMJSExtension = filePath.endsWith(`.mjs`)
    ? filePath
    : `${filePath}.mjs`

  // 両方のバリエーションが存在するかを確認する
  try {
    if (
      require.resolve(filePathWithJSExtension) &&
      require.resolve(filePathWithMJSExtension)
    ) {
      if (warn) {
        report.warn(
          `The file '${path.relative(
            rootDir,
            filePath
          )}' has both .js and .mjs variants, please use one or the other. Using .js by default.`
        )
      }
      return filePathWithJSExtension
    }
  } catch (_) {
    // 何もしない
  }

  // .js のバリエーションが存在するかを確認する
  try {
    if (require.resolve(filePathWithJSExtension)) {
      return filePathWithJSExtension
    }
  } catch (_) {
    // 何もしない
  }

  try {
    if (require.resolve(filePathWithMJSExtension)) {
      return filePathWithMJSExtension
    }
  } catch (_) {
    // 何もしない
  }

  return ``
}
