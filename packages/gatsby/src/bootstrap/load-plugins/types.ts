export interface IRawSiteConfig {
  plugins?: Array<PluginRef>
}

export interface ISiteConfig extends IRawSiteConfig {
  plugins?: Array<IPluginRefObject>
}

// トップレベルの「Plugin」の概念は 2 つある:
// 1. 処理済みのプラグインを表す IPluginInfo
// 2. プラグインの設定を表す PluginRef

export interface IPluginInfo {
  /** プラグインを表す一意な ID */
  id: string

  /** プラグインへの絶対パス */
  resolve: string

  /** コンパイル済みのプラグインの gatsby-node モジュールへの絶対パス（存在する場合） */
  resolvedCompiledGatsbyNode?: string

  /** プラグインの名前 */
  name: string

  /** プラグインのバージョン（コンテンツのハッシュのこともある） */
  version: string

  /** プラグインに渡されるオプション */
  pluginOptions?: IPluginInfoOptions

  subPluginPaths?: Array<string>
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
