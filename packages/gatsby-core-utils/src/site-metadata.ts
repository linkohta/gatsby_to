import * as fs from "fs-extra"
import { createServiceLock, getService } from "./service-lock"
import { readConfigFile, getConfigPath } from "./utils"
import { lock } from "./lock"

export interface ISiteMetadata {
  sitePath: string
  name?: string
  pid?: number
  lastRun?: number
}

export async function getInternalSiteMetadata(
  sitePath: string
): Promise<ISiteMetadata | null> {
  return getService(sitePath, `metadata`, true)
}

export async function updateInternalSiteMetadata(
  metadata: ISiteMetadata,
  merge = true
): Promise<void> {
  if (merge) {
    const oldMetadata = await getInternalSiteMetadata(metadata.sitePath)
    if (oldMetadata) {
      metadata = { ...oldMetadata, ...metadata }
    }
  }

  return createServiceLock(metadata.sitePath, `metadata`, metadata).then(
    unlock => unlock?.()
  )
}

// TODO(v5): 再び削除する。https://github.com/gatsbyjs/gatsby/pull/34094 での名前変更のために必要
export { updateInternalSiteMetadata as updateSiteMetadata }

/**
 * "siteMetadata" の先頭を探して文字列置換を行う
 * そして、名前と値をそのオブジェクトの次のキーとして追加する
 */
function addField(
  src: string,
  { name, value }: { name: string; value: string }
): string {
  const FIND = `  siteMetadata: {\n`
  const REPLACE = `  siteMetadata: {\n    ${name}: \`${value}\`,\n`
  const modifiedConfig = src.replace(FIND, REPLACE)
  return modifiedConfig
}

export async function addFieldToMinimalSiteMetadata(
  { root }: { root: string },
  { name, value }: { name: string; value: string }
): Promise<void> {
  const release = await lock(`gatsby-config.js`)
  const configSrc = await readConfigFile(root)

  const code = addField(configSrc, { name, value })

  await fs.writeFile(getConfigPath(root), code)
  release()
}
