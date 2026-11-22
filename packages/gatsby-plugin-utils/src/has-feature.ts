import type { AvailableFeatures } from "gatsby"

/**
 * 利用できる機能の一覧は readme を参照。
 */
export function hasFeature(name: AvailableFeatures): boolean {
  try {
    const availableAPIs = require(`gatsby/apis.json`)

    return !!availableAPIs?.features?.includes(name)
  } catch (e) {
    throw new Error(
      `Couldn't check available APIs. Make sure you are on gatsby version >=2.13.41`
    )
  }
}
