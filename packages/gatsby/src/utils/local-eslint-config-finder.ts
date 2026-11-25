import path from "path"
import { globSync } from "./glob"
import debug from "debug"
import report from "gatsby-cli/lib/reporter"

const log = debug(`gatsby:webpack-eslint-config`)

export const hasLocalEslint = (directory: string): boolean => {
  try {
    log(`Attempting to load package.json for eslint config check`)

    const pkg = require(path.resolve(directory, `package.json`))
    if (pkg.eslintConfig) {
      return true
    }
  } catch (err) {
    report.error(`There was a problem processing the package.json file`, err)
  }

  log(`Checking for eslint config file`)
  // `.eslintrc*` に加えて、flat config（`eslint.config.*`）も、サイト独自の設定として扱う
  const eslintFiles = [
    `.eslintrc?(.js|.json|.yaml|.yml)`,
    `eslint.config.@(js|mjs|cjs|ts|mts|cts)`,
  ].flatMap(pattern => globSync(pattern, { cwd: directory }))

  if (eslintFiles.length) {
    return true
  }

  return false
}
