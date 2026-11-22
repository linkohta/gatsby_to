import path from "path"
import fs from "fs"
import { createRequire } from "module"
import { slash } from "gatsby-core-utils"
import { warnOnIncompatiblePeerDependency } from "./validate"
import { PackageJson } from "../../.."
import { IPluginInfo, PluginRef } from "./types"
import { createPluginId } from "./utils/create-id"
import { createFileContentHash } from "./utils/create-hash"
import reporter from "gatsby-cli/lib/reporter"
import { isString } from "lodash"
import { checkLocalPlugin } from "./utils/check-local-plugin"
import { getResolvedFieldsForPlugin } from "../../utils/parcel/compile-gatsby-files"

/**
 * @param plugin
 * 可能な限りプラグインの仕様オブジェクトにすべきだが、
 * プラグインの名前でもよい。
 *
 * 名前の場合は、ローカルプラグインの名前、node_modules にあるプラグインの名前、
 * または Gatsby の内部プラグインのいずれかになる。最後の場合、
 * plugin は絶対パスになる。
 * @param rootDir
 * プロジェクトの場所。ここを起点にプラグインを探す
 */
export function resolvePlugin(plugin: PluginRef, rootDir: string): IPluginInfo {
  const pluginName = isString(plugin) ? plugin : plugin.resolve

  // ローカルプラグインを処理する
  const { validLocalPlugin, localPluginPath = `` } = checkLocalPlugin(
    plugin,
    rootDir
  )

  if (validLocalPlugin && localPluginPath) {
    const packageJSON = JSON.parse(
      fs.readFileSync(`${localPluginPath}/package.json`, `utf-8`)
    ) as PackageJson
    const name = packageJSON.name || pluginName
    warnOnIncompatiblePeerDependency(name, packageJSON)

    return {
      resolve: localPluginPath,
      name,
      id: createPluginId(name),
      version:
        packageJSON?.version || createFileContentHash(localPluginPath, `**`),
      ...getResolvedFieldsForPlugin(rootDir, name),
    }
  }

  /**
   * ここに来るのは、内部プラグインへの絶対パスか、node_modules にあるはずの
   * モジュールの名前である。
   */
  try {
    const requireSource =
      rootDir !== null ? createRequire(`${rootDir}/:internal:`) : require

    // パスが絶対パスの場合は、内部プラグインのディレクトリを解決する。
    // そうでなければ、package.json を含むディレクトリを解決する
    const resolvedPath = slash(
      path.dirname(
        requireSource.resolve(
          path.isAbsolute(pluginName)
            ? pluginName
            : `${pluginName}/package.json`
        )
      )
    )

    const packageJSON = JSON.parse(
      fs.readFileSync(`${resolvedPath}/package.json`, `utf-8`)
    )
    warnOnIncompatiblePeerDependency(packageJSON.name, packageJSON)

    return {
      resolve: resolvedPath,
      id: createPluginId(packageJSON.name),
      name: packageJSON.name,
      version: packageJSON.version,
    }
  } catch (err) {
    if (process.env.gatsby_log_level === `verbose`) {
      reporter.panicOnBuild(
        `plugin "${pluginName} threw the following error:\n`,
        err
      )
    } else {
      reporter.panicOnBuild(
        `There was a problem loading plugin "${pluginName}". Perhaps you need to install its package?\nUse --verbose to see actual error.`
      )
    }
    throw new Error(`unreachable`)
  }
}
