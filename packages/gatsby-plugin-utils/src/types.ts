/**
 * ⚠️ 編集しないこと ⚠️
 * これらの型は packages/gatsby/src/bootstrap/load-plugins/types.ts から複製したものである
 * このファイルを編集する場合は、必ずそちらのファイルも編集すること
 * 複製しているのは、gatsby-plugin-utils <=> gatsby <=> gatsby-plugin-utils の循環依存を避けるためである
 * gatsbyjs/gatsby#27578 を参照
 */

export interface IRawSiteConfig {
  plugins?: Array<PluginRef>
}

export interface ISiteConfig extends IRawSiteConfig {
  plugins?: Array<IPluginRefObject>
}

// トップレベルの "Plugin" の概念は 2 つある:
// 1. 処理済みのプラグインを表す IPluginInfo
// 2. プラグインの設定を表す PluginRef

export interface IPluginInfo {
  /** プラグインを表す一意な ID */
  id: string

  /** プラグインの絶対パス */
  resolve: string

  /** プラグイン名 */
  name: string

  /** プラグインのバージョン（コンテンツハッシュの場合もある） */
  version: string

  /** プラグインに渡されたオプション */
  pluginOptions?: IPluginInfoOptions

  module?: any
  modulePath?: string
}

export interface IPluginInfoOptions {
  plugins?: Array<IPluginInfo>
  path?: string
  [option: string]: unknown
}

export interface IFlattenedPlugin extends IPluginInfo {
  skipSSR?: boolean
  ssrAPIs: Array<string>
  nodeAPIs: Array<string>
  browserAPIs: Array<string>
}

export interface IPluginRefObject {
  resolve: string
  options?: IPluginRefOptions
  parentDir?: string
  subPluginPaths?: Array<string>
  module?: any
  modulePath?: string
}

export type PluginRef = string | IPluginRefObject

export interface IPluginRefOptions {
  plugins?: Array<PluginRef>
  path?: string
  [option: string]: unknown
}
