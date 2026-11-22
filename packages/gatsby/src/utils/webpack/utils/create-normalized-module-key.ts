import path from "path"
import { slash } from "gatsby-core-utils"

/**
 * partial hydration の webpack ローダーとプラグインの両方から参照される、正規化したモジュールキーを作る。
 * モジュールの import が環境（ブラウザー、Node など）によって異なる形でバンドルされる問題を、これで解決する。
 *
 * ローカルのモジュールの場合、キーはプロジェクトルートからの相対パスになる（例: `file://src/components/index.js`）。
 * node モジュールの場合、キーは `node_modules` 内のモジュール名までの相対パスになる（例: `file://node_modules/react`）。
 *
 * @param resourcePath リソースの絶対パス
 * @param rootContext プロジェクトルートの絶対パス
 * @returns 正規化したモジュールキー
 */
export function createNormalizedModuleKey(
  resourcePath: string,
  rootContext: string
): string {
  const rootRelativeFilePath = resourcePath.replace(rootContext, ``)
  const [rootRelativeDir, potentialModuleName] = rootRelativeFilePath
    .split(path.sep)
    .filter(Boolean)
  const normalizedModuleKey =
    rootRelativeDir === `node_modules`
      ? `file://${path.join(rootRelativeDir, potentialModuleName)}`
      : `file://${rootRelativeFilePath.slice(1)}`
  return slash(normalizedModuleKey)
}
