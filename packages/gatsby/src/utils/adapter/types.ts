import type reporter from "gatsby-cli/lib/reporter"
import type { TrailingSlash } from "gatsby-page-utils"
import type { IHeader, HttpStatusCode } from "../../redux/types"

import type {
  ImageCdnUrlGeneratorFn,
  ImageCdnSourceImage,
  ImageCdnTransformArgs,
  FileCdnUrlGeneratorFn,
  FileCdnSourceImage,
} from "gatsby-plugin-utils/dist/polyfill-remote-file/types"

export type {
  ImageCdnUrlGeneratorFn,
  ImageCdnSourceImage,
  ImageCdnTransformArgs,
  FileCdnUrlGeneratorFn,
  FileCdnSourceImage,
}

interface IBaseRoute {
  /**
   * このルートで照合するリクエストのパス。
   * 次のいずれかである:
   *  - 静的: `/about/`
   *  - 動的:
   *    - パラメーター付き: `/blog/:slug/`
   *    - キャッチオール / ワイルドカード: `/app/*`
   */
  path: string
}

export interface IStaticRoute extends IBaseRoute {
  type: `static`
  /**
   * このルートで配信するファイルの場所。
   */
  filePath: string
  /**
   * このルートで設定する HTTP ヘッダー。
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/headers/
   */
  headers: IHeader[`headers`]
}

export interface IFunctionRoute extends IBaseRoute {
  type: `function`
  /**
   * この関数の一意な識別子。`functionsManifest` の中の `functionId` に対応する。
   * 一部の関数は、複数のルートで共有される。たとえば SSR や DSG の関数。
   */
  functionId: string
  /**
   * `cache` が true の場合、関数のレスポンスは現在のデプロイの間キャッシュし、このルートへの以降のリクエストで配信すべきである。
   */
  cache?: true
}

/**
 * リダイレクトは `createRedirect` アクションによって作成される。
 * @see https://www.gatsbyjs.com/docs/reference/config-files/actions/#createRedirect
 */
export interface IRedirectRoute extends IBaseRoute {
  type: `redirect`
  /**
   * リダイレクトは `path` から `toPath` へ行う。
   */
  toPath: string
  /**
   * このリダイレクトで使う HTTP ステータスコード。
   */
  status: HttpStatusCode
  ignoreCase?: boolean
  /**
   * このリダイレクトで使う HTTP ヘッダー。
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/headers/
   */
  headers: IHeader[`headers`]
  [key: string]: unknown
}

export type Route = IStaticRoute | IFunctionRoute | IRedirectRoute

export type RoutesManifest = Array<Route>

export interface IHeaderRoute extends IBaseRoute {
  headers: IHeader[`headers`]
}

export type HeaderRoutes = Array<IHeaderRoute>
export interface IFunctionDefinition {
  /**
   * この関数の一意な識別子。`routesManifest` の中の `functionId` に対応する。
   */
  functionId: string
  /**
   * この関数の一意な名前。関数の表示名として使う。
   */
  name: string
  /**
   * 関数の作成に使う、関数のエントリーポイントへのパス
   */
  pathToEntryPoint: string
  /**
   * この関数の実行に必要なすべてのファイルの一覧
   */
  requiredFiles: Array<string>
}

export type FunctionsManifest = Array<IFunctionDefinition>

interface IDefaultContext {
  /**
   * ターミナルへメッセージを出力するために使える reporter のインスタンス
   * @see https://www.gatsbyjs.com/docs/reference/config-files/node-api-helpers/#reporter
   */
  reporter: typeof reporter
}

export type RemoteFileAllowedUrls = Array<{
  /**
   * URLPattern 形式で表した、許可する URL。具体的には、ワイルドカードの `*` とパラメーターの `:param` の構文を使う。
   */
  urlPattern: string
  /**
   *正規表現のソース形式で表した、許可する URL
   */
  regexSource: string
}>

export interface IAdaptContext extends IDefaultContext {
  routesManifest: RoutesManifest
  functionsManifest: FunctionsManifest
  headerRoutes: HeaderRoutes
  /**
   * @see https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/#pathprefix
   */
  pathPrefix: string
  /**
   * @see https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/#trailingslash
   */
  trailingSlash: TrailingSlash
  /**
   * 許可するリモートファイルの URL の一覧。URLPattern と正規表現の形式で表される。
   * 許可する URL は、ユーザーまたはプラグインが `addRemoteFileAllowedUrl` アクションを使って指定する。
   * @see https://www.gatsbyjs.com/docs/reference/config-files/actions/#addRemoteFileAllowedUrl
   */
  remoteFileAllowedUrls: RemoteFileAllowedUrls
}

export interface ICacheContext extends IDefaultContext {
  directories: Array<string>
}

export interface IAdapterConfig {
  /**
   * 個々のデプロイに固有の URL
   */
  deployURL?: string
  /**
   * `true` の場合、Gatsby は SSR/DSG に使うサーバーレス関数に LMDB データストアを含めない。
   * 代わりに、指定された `deployURL` からデータストアのダウンロードを試みる。
   */
  excludeDatastoreFromEngineFunction?: boolean
  /**
   * アダプターは、問題のあるデプロイを防ぐために、対応している機能を必要に応じて宣言できる
   */
  supports?: {
    /**
     * `false` の場合、ユーザーが pathPrefix を使おうとすると、Gatsby はビルドを失敗させる。
     */
    pathPrefix?: boolean
    /**
     * 対応している末尾のスラッシュのオプションを配列で指定する
     * @example [`always`]
     */
    trailingSlash?: Array<TrailingSlash>
  }
  /**
   * このアダプターを使うときに無効にすべきプラグインの一覧。その目的は、アダプターと似た役割を
   * 果たし、プラグインとアダプターを同時に使うと衝突を起こしうるプラグインを
   * 無効にすることである。
   */
  pluginsToDisable?: Array<string>
  /**
   * Image CDN の URL を生成する関数を実装した CommonJS モジュールへのパス。この関数は、
   * CDN の機能を活用する URL を生成することで、画像の配信を最適化するために使われる。このモジュールは、
   * {@link ImageCdnUrlGeneratorFn} 型に適合する関数をデフォルト export していなければならない:
   *
   * アダプターは、このモジュールへの絶対パスを指定すること。
   * Netlify アダプターでの実装例として、
   * 'packages/gatsby-adapter-netlify/src/image-cdn-url-generator.ts' を参照。
   */
  imageCDNUrlGeneratorModulePath?: string
  /**
   * File CDN の URL を生成する関数を実装した CommonJS モジュールへのパス。このモジュールは、
   * {@link FileCdnUrlGeneratorFn} 型に適合する関数をデフォルト export していなければならない:
   *
   * アダプターは、このモジュールへの絶対パスを指定すること。
   * Netlify アダプターでの実装例として、
   * 'packages/gatsby-adapter-netlify/src/file-cdn-url-generator.ts' を参照。
   */
  fileCDNUrlGeneratorModulePath?: string
  /**
   * バンドルされた関数が実行されるプラットフォーム。通常は `linux` にする。
   * これは、ユーザーが環境変数 `GATSBY_FUNCTIONS_PLATFORM` も CLI の
   * `-functions-platform` も指定しなかった場合に使われる。どれも定義されていなければ、現在のプラットフォーム（process.platform）が使われる。
   */
  functionsPlatform?: string
  /**
   * バンドルされた関数が実行されるアーキテクチャ。通常は `x64` にする。
   * これは、ユーザーが環境変数 `GATSBY_FUNCTIONS_ARCH` も CLI の
   * `-functions-arch` も指定しなかった場合に使われる。どれも定義されていなければ、現在のアーキテクチャ（process.arch）が使われる。
   */
  functionsArch?: string
}

type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] }

/**
 * これは "IAdapterConfig" の内部用のバージョンであり、特定のキーが必ず存在することを強制する。
 * アダプターの作者に見えるのは "IAdapterConfig" だけである。
 */
export type IAdapterFinalConfig = WithRequired<
  IAdapterConfig,
  `excludeDatastoreFromEngineFunction` | `pluginsToDisable`
>

export interface IAdapter {
  /**
   * アダプターの一意な名前。マニフェストの中でアダプターを識別するために使う。
   */
  name: string
  cache?: {
    /**
     * 以前のビルドの `directories` を復元するためのフック。ビルドの処理のかなり早い段階で実行される。`false` を返すと、Gatsby はキャッシュの復元をスキップする。
     */
    restore: (
      context: ICacheContext
    ) => Promise<boolean | void> | boolean | void
    /**
     * 現在のビルドの `directories` を保存するためのフック。ビルドの処理の最後のほうのステップとして実行される。
     */
    store: (context: ICacheContext) => Promise<void> | void
  }
  /**
   * Gatsby の出力を受け取り、アダプターのプラットフォームへのデプロイに向けて準備するためのフック。ビルドの処理の最後のほうのステップとして実行される。
   *
   * `adapt` フックは次のことを行うべきである:
   * - アセットに HTTP ヘッダーを適用する
   * - リダイレクトとリライトを適用する。アダプターは、必要に応じて独自のリダイレクトやリライトを作成することもできる（たとえば、サーバーレス関数を内部の URL に対応付ける）。
   * - Gatsby から渡されるサーバーレス関数を、（必要に応じて）プラットフォーム固有のコードでラップする。Gatsby は [Express 風の](https://expressjs.com/) ハンドラーを生成する。
   * - URL に末尾のスラッシュの動作とパスのプレフィックスを適用する
   * - 場合によっては、アセットを CDN にアップロードする
   *
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/creating-an-adapter/
   */
  adapt: (context: IAdaptContext) => Promise<void> | void
  /**
   * アダプターから Gatsby へ情報を渡すためのフック。あらかじめ決められた形のオブジェクトを返さなければならない。
   * Gatsby はこの情報を使ってビルドの処理を調整する。たとえば、プロジェクトがデプロイされて初めて分かる情報などを渡せる。
   *
   * このフックはアダプターの高度な機能を有効にするものであり、実装は必須ではない。
   *
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/creating-an-adapter/
   */
  config?: (
    context: IDefaultContext
  ) => Promise<IAdapterConfig> | IAdapterConfig
}

/**
 * アダプターのインスタンスを返す、アダプターの初期化関数。
 * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/creating-an-adapter/
 */
export type AdapterInit<T = Record<string, unknown>> = (
  adapterOptions?: T
) => IAdapter

export interface IAdapterManager {
  restoreCache: () => Promise<void> | void
  storeCache: () => Promise<void> | void
  adapt: () => Promise<void> | void
  config: () => Promise<IAdapterFinalConfig>
}
/**
 * gatsby/adapters.js 用の型
 * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/zero-configuration-deployments/
 */
export interface IAdapterManifestEntry {
  /**
   * アダプターの名前
   */
  name: string
  /**
   * アダプターを使うべきかを判定するテスト関数
   */
  test: () => boolean
  /**
   * アダプターの npm モジュール名
   */
  module: string
  /**
   * アダプターが対応しているバージョンの組の一覧。
   * これにより、Gatsby のバージョンごとに異なるバージョンのアダプターを用意できる。
   * API が変更されたり、バグ修正のために別の実装が必要になったりした場合に役立つ。
   */
  versions: Array<{
    /**
     * `gatsby` パッケージのバージョン。semver の範囲で指定する。
     */
    gatsbyVersion: string
    /**
     * アダプターのバージョン。semver の範囲で指定する。
     */
    moduleVersion: string
    /**
     * 親のマニフェストのエントリーで定義されたモジュールを上書きできる。アダプターの名前が変わった場合に役立つ。
     */
    module?: string
  }>
}
