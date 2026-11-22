import { PluginRef } from "../types"
import { sync as existsSync } from "fs-exists-cached"
import { slash } from "gatsby-core-utils"
import path from "path"

/**
 * プラグインが有効なローカルプラグインかどうかを確認し、有効であれば解決したパスを返す。
 */
export function checkLocalPlugin(
  plugin: PluginRef,
  rootDir: string
): { validLocalPlugin: boolean; localPluginPath?: string } {
  const pluginName = typeof plugin === `string` ? plugin : plugin.resolve

  // プラグインが相対的な位置に存在することを確認する
  if (existsSync(pluginName) || !rootDir) {
    return {
      validLocalPlugin: false,
    }
  }

  const resolvedPath = slash(path.join(rootDir, `plugins/${pluginName}`))

  if (!existsSync(resolvedPath)) {
    return {
      validLocalPlugin: false,
    }
  }

  const resolvedPackageJson = existsSync(`${resolvedPath}/package.json`)

  // ローカルプラグインには package.json が必須である
  if (!resolvedPackageJson) {
    throw new Error(`Local plugin ${pluginName} requires a package.json file`)
  }

  return {
    validLocalPlugin: true,
    localPluginPath: resolvedPath,
  }
}
