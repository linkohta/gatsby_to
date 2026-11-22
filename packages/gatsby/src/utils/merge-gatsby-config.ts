import _ from "lodash"
import { Express } from "express"
import type { TrailingSlash } from "gatsby-page-utils"

export interface IPluginEntryWithParentDir {
  resolve: string
  options?: Record<string, unknown>
  parentDir: string
}
// TODO index.d.ts で export する
export type PluginEntry = string | IPluginEntryWithParentDir

export interface IGatsbyConfigInput {
  siteMetadata?: Record<string, unknown>
  plugins?: Array<PluginEntry>
  pathPrefix?: string
  assetPrefix?: string
  polyfill?: boolean
  mapping?: Record<string, string>
  proxy?: {
    prefix: string
    url: string
  }
  developMiddleware?(app: Express): void
  jsxRuntime?: "classic" | "automatic"
  jsxImportSource?: string
  trailingSlash?: TrailingSlash
}

type ConfigKey = keyof IGatsbyConfigInput
type Metadata = IGatsbyConfigInput["siteMetadata"]
type Mapping = IGatsbyConfigInput["mapping"]

const howToMerge = {
  /**
   * デフォルトでは truthy な値を選ぶ。
   * これにより、値が 1 つだけ定義されている場合は、その値が使われる。
   * 「右側」の値を優先する。ユーザーの config が「右側」に来るためである
   */
  byDefault: (a: ConfigKey, b: ConfigKey): ConfigKey => b || a,
  siteMetadata: (objA: Metadata, objB: Metadata): Metadata =>
    _.merge({}, objA, objB),
  // plugins は連結して重複を取り除くので、同じプラグインの値が 2 つになることはない
  plugins: (
    a: Array<PluginEntry> = [],
    b: Array<PluginEntry> = []
  ): Array<PluginEntry> => a.concat(b),
  mapping: (objA: Mapping, objB: Mapping): Mapping => _.merge({}, objA, objB),
} as const

/**
 * テーマのオブジェクトをユーザーの config とマージする方法を定義する
 */
export const mergeGatsbyConfig = (
  a: IGatsbyConfigInput,
  b: IGatsbyConfigInput
): IGatsbyConfigInput => {
  // a と b は gatsby の config である。キーがあれば、マージする値があることを意味する
  const allGatsbyConfigKeysWithAValue = _.uniq(
    Object.keys(a).concat(Object.keys(b))
  ) as Array<ConfigKey>

  // マージできるキーの配列を、1 つの gatsby の config オブジェクトにまとめる
  const mergedConfig = allGatsbyConfigKeysWithAValue.reduce(
    (config, gatsbyConfigKey) => {
      // その config のキーに対するマージ関数が定義されていればそれを選び、
      // なければデフォルトの値のマージ関数を使う
      const mergeFn = howToMerge[gatsbyConfigKey] || howToMerge.byDefault
      return {
        ...config,
        [gatsbyConfigKey]: mergeFn(a[gatsbyConfigKey], b[gatsbyConfigKey]),
      }
    },
    {} as IGatsbyConfigInput
  )

  // 完全にマージされた config を返す
  return mergedConfig
}
