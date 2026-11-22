import * as React from "react"
import { Renderer } from "react-dom"
import { EventEmitter } from "events"
import { WindowLocation, NavigateOptions } from "@reach/router" // これらは `@types/reach__router` に由来する
import { Reporter } from "gatsby-cli/lib/reporter/reporter"
import { Span } from "opentracing"
export { Reporter }
import {
  EnumTypeComposerAsObjectDefinition as ComposeEnumTypeConfig,
  InputTypeComposerAsObjectDefinition as ComposeInputObjectTypeConfig,
  InterfaceTypeComposerAsObjectDefinition as ComposeInterfaceTypeConfig,
  ObjectTypeComposerAsObjectDefinition as ComposeObjectTypeConfig,
  ScalarTypeComposerAsObjectDefinition as ComposeScalarTypeConfig,
  UnionTypeComposerAsObjectDefinition as ComposeUnionTypeConfig,
} from "graphql-compose"
import { GraphQLOutputType } from "graphql"
import { PluginOptionsSchemaJoi, ObjectSchema } from "gatsby-plugin-utils"
import { IncomingMessage, ServerResponse } from "http"

export type AvailableFeatures =
  | "image-cdn"
  | "graphql-typegen"
  | "content-file-path"
  | "stateful-source-nodes"
  | "adapters"

export {
  Link,
  GatsbyLinkProps,
  navigate,
  withPrefix,
  withAssetPrefix,
} from "gatsby-link"

export * from "gatsby-script"

export {
  AdapterInit,
  IAdapter,
  IStaticRoute,
  IFunctionRoute,
  IRedirectRoute,
  IFunctionDefinition,
  RoutesManifest,
  HeaderRoutes,
  FunctionsManifest,
  IAdapterConfig,
  ImageCdnUrlGeneratorFn,
  ImageCdnSourceImage,
  ImageCdnTransformArgs,
  FileCdnUrlGeneratorFn,
  FileCdnSourceImage,
  RemoteFileAllowedUrls,
} from "./dist/utils/adapter/types"

export const useScrollRestoration: (key: string) => {
  ref: React.MutableRefObject<HTMLElement | undefined>
  onScroll(): void
}

export class StaticQueryDocument {
  /** 構造的な型の拡大を防ぐ。 */
  #kind: "StaticQueryDocument"

  /** デバッグ用に、静的クエリのハッシュへ型安全にアクセスできるようにする。 */
  toString(): string
}

/**
 * StaticQuery の React Hooks 版。
 *
 * StaticQuery は、フラグメントを含め、ページクエリでできることのほとんどができる。主な違いは次のとおり:
 *
 * - ページクエリは（`pageContext` 経由で）変数を受け取れるが、_ページ_ コンポーネントにしか追加できない
 * - StaticQuery は変数を受け取れない（そのため「static」という名前である）が、ページを含む _どの_ コンポーネントでも使える
 *
 * @see https://www.gatsbyjs.com/docs/how-to/querying-data/use-static-query/
 */
export const useStaticQuery: <TData = any>(query: StaticQueryDocument) => TData

export const parsePath: (path: string) => WindowLocation

export const prefetchPathname: (path: string) => void

/**
 * Gatsby のページに型安全性を加えるための props オブジェクト。
 * クエリのレスポンスの形と、ページコンテキストの両方で拡張できる。
 *
 * @example
 * // When typing a default page from the ./pages dir
 *
 * import {PageProps} from "gatsby"
 * export default (props: PageProps) => {
 *
 * @example
 * // When adding types for both pageContext (represented by LocaleLookUpInfo)
 * // and GraphQL query data (represented by IndexQueryProps)
 *
 * import {PageProps} from "gatsby"
 *
 * type IndexQueryProps = { downloadCount: number }
 * type LocaleLookUpInfo = { translationStrings: any } & { langKey: string, slug: string }
 * type IndexPageProps = PageProps<IndexQueryProps, LocaleLookUpInfo>
 *
 * export default (props: IndexPageProps) => {
 *   ..
 */
export type PageProps<
  DataType = object,
  PageContextType = object,
  LocationState = WindowLocation["state"],
  ServerDataType = object
> = {
  /** 現在のページのパス */
  path: string
  /** 現在のページの URI */
  uri: string
  /** @react/router に由来する、window.document の拡張版 */
  location: WindowLocation<LocationState>
  /** これはユーザー側のルートコンポーネントなので、children を受け取ることはできない */
  children: undefined
  /** ページに `matchPath` がある場合の URL パラメーター */
  params: Record<string, string>
  /** このコンポーネントのビルド処理に関する情報を保持する */
  pageResources: {
    component: React.Component
    json: {
      data: DataType
      pageContext: PageContextType
    }
    page: {
      componentChunkName: string
      path: string
      webpackCompilationHash: string
      matchPath?: string
    }
  }
  /**
   * export された GraphQL クエリを通じてページへ渡されるデータ。この型を設定するには
   * [ジェネリクス](https://www.typescriptlang.org/play/#example/generic-functions) を使う必要がある。
   * 例は以下を参照
   *
   * @example
   *
   * import {PageProps} from "gatsby"
   *
   * type IndexQueryProps = { downloadCount: number }
   * type IndexPageProps = PageProps<IndexQueryProps>
   *
   * export default (props: IndexPageProps) => {
   *   ..
   */
  data: DataType
  /**
   * ページの作成時に渡されるコンテキストオブジェクト。自分で `createPage` を使っている場合は、
   * ジェネリクスを使って拡張できる:
   *
   * @example
   *
   * import {PageProps} from "gatsby"
   *
   * type IndexQueryProps = { downloadCount: number }
   * type LocaleLookUpInfo = { translationStrings: any } & { langKey: string, slug: string }
   * type IndexPageProps = PageProps<IndexQueryProps, LocaleLookUpInfo>
   *
   * export default (props: IndexPageProps) => {
   *   ..
   */
  pageContext: PageContextType
  /** SSR の関数 [getServerData](https://www.gatsbyjs.com/docs/reference/rendering-options/server-side-rendering/) を通じてページへ渡されるデータ。 */
  serverData: ServerDataType
}

/**
 * [Gatsby Head API](https://gatsby.dev/gatsby-head) の Head 関数へ渡される props オブジェクト。
 */
export type HeadProps<
  DataType = object,
  PageContextType = object,
  ServerDataType = object
> = {
  location: {
    /**
     * Location オブジェクトの URL のパスを返す。
     */
    pathname: string
  }
  /** ページに `matchPath` がある場合の URL パラメーター */
  params: Record<string, string>
  /**
   * export された GraphQL クエリを通じてページへ渡されるデータ。
   */
  data: DataType
  /**
   * ページの作成時に渡されるコンテキストオブジェクト。
   */
  pageContext: PageContextType
  /**
   * SSR の関数 [getServerData](https://www.gatsbyjs.com/docs/reference/rendering-options/server-side-rendering/) を通じてページへ渡されるデータ。
   */
  serverData: ServerDataType
}

/**
 * [Gatsby Head API](https://gatsby.dev/gatsby-head) の props と戻り値の型をまとめた短縮形の型。
 */
export type HeadFC<DataType = object, PageContextType = object> = (
  props: HeadProps<DataType, PageContextType>
) => JSX.Element

type SerializableProps =
  | ISerializableObject
  | Array<SerializableProps>
  | string
  | number
  | boolean
  | null
  | undefined

interface ISerializableObject {
  [key: string]: SerializableProps
}

/**
 * [スライスのプレースホルダー](https://gatsbyjs.com/docs/reference/built-in-components/gatsby-slice/) 用の props オブジェクト
 */
export interface SlicePlaceholderProps {
  alias: string
  allowEmpty?: boolean
  children?: React.ReactNode
  [key: string]: SerializableProps | React.ReactNode
}

/**
 * スライスのプレースホルダーとして使うコンポーネント。ページ内で [スライス](https://gatsbyjs.com/docs/reference/built-in-components/gatsby-slice/) を挿入する位置を示す。
 */
export declare function Slice(props: SlicePlaceholderProps): JSX.Element

/**
 * [スライスコンポーネント](https://gatsbyjs.com/docs/reference/built-in-components/gatsby-slice/) 用の props オブジェクト
 */
export type SliceComponentProps<
  DataType = object,
  SliceContextType = object,
  AdditionalSerializableProps extends ISerializableObject = object
> = {
  data: DataType
  sliceContext: SliceContextType
  children?: React.ReactNode
} & AdditionalSerializableProps

/**
 * [getServerData](https://www.gatsbyjs.com/docs/reference/rendering-options/server-side-rendering/) 関数へ渡される props オブジェクト。
 */
export type GetServerDataProps = {
  headers: Map<string, unknown>
  method: string
  url: string
  query?: Record<string, unknown>
  params?: Record<string, unknown>
  pageContext: Record<string, unknown>
}

/**
 * [getServerData](https://www.gatsbyjs.com/docs/reference/rendering-options/server-side-rendering/) 関数の戻り値の型（promise のペイロード）。
 */
export type GetServerDataReturn<ServerDataType = Record<string, unknown>> =
  Promise<{
    headers?: Record<string, unknown>
    props?: ServerDataType
    status?: number
  }>

/**
 * [getServerData](https://www.gatsbyjs.com/docs/reference/rendering-options/server-side-rendering/) 関数の props と戻り値の型をまとめた短縮形の型。
 */
export type GetServerData<ServerDataType> = (
  props: GetServerDataProps
) => GetServerDataReturn<ServerDataType>

/**
 * PageRenderer のコンストラクター引数。
 */
export interface PageRendererProps {
  location: WindowLocation
}

/**
 * PageRenderer のコンストラクターは、パスに対応する [ページリソースを読み込む](https://www.gatsbyjs.com/docs/production-app/#load-page-resources)。
 *
 * ただし初回の読み込み時には、ページの元の HTML にある `<link rel="preload" ... />` によって、これらはすでにサーバーへリクエスト済みである（HTML 生成のドキュメントの [Link Preloads](https://www.gatsbyjs.com/docs/how-code-splitting-works/#construct-link-and-script-tags-for-current-page) を参照）。
 * 読み込まれたページリソースには import されたコンポーネントが含まれており、それを使って [React.createElement()](https://reactjs.org/docs/react-api.html) で実際のページコンポーネントを作成する。この要素は RouteHandler に返され、RouteHandler がレンダリングのために Reach Router へ渡す。
 *
 * @see https://www.gatsbyjs.com/docs/production-app/#page-rendering
 */
export class PageRenderer extends React.Component<PageRendererProps> {}

type RenderCallback<T = any> = (data: T) => React.ReactNode

export interface StaticQueryProps<T = any> {
  query: StaticQueryDocument
  render?: RenderCallback<T>
  children?: RenderCallback<T>
}

/**
 * StaticQuery は、フラグメントを含め、ページクエリでできることのほとんどができる。主な違いは次のとおり:
 *
 * - ページクエリは（`pageContext` 経由で）変数を受け取れるが、_ページ_ コンポーネントにしか追加できない
 * - StaticQuery は変数を受け取れない（そのため「static」という名前である）が、ページを含む _どの_ コンポーネントでも使える
 * - StaticQuery は React.createElement を直接呼び出す書き方では動作しない。`<StaticQuery />` のように JSX を使うこと
 *
 * @see https://www.gatsbyjs.com/docs/static-query/
 */

export class StaticQuery<T = any> extends React.Component<
  StaticQueryProps<T>
> {}

/**
 * graphql はタグ関数である。Gatsby は内部でこのタグを特別な方法で処理する
 *
 * Gatsby のビルド処理の中で、GraphQL クエリは解析のために元のソースから取り出される。
 *
 * @see https://www.gatsbyjs.com/docs/page-query#how-does-the-graphql-tag-work
 */
export const graphql: (query: TemplateStringsArray) => StaticQueryDocument

export interface GraphQLTypegenOptions {
  typesOutputPath?: string
  documentSearchPaths?: string[]
  generateOnBuild?: boolean
}

type Proxy = {
  prefix: string
  url: string
}

type Header = {
  /**
   * リクエストと照合するパス。
   */
  source: string
  /**
   * 独自のレスポンスヘッダー。
   */
  headers: Array<{
    key: string
    value: string
  }>
}

/**
 * Gatsby の設定 API。
 *
 * @see https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/
 */
export interface GatsbyConfig {
  /** サイト全体で共通のデータ（サイトのタイトルなど）を再利用したい場合は、ここに保存できる。 */
  siteMetadata?: Record<string, unknown>
  /** プラグインは Gatsby の API を実装した Node.js パッケージである。設定ファイルはプラグインの配列を受け取る。名前を列挙するだけでよいプラグインもあれば、オプションを取るプラグインもある。 */
  plugins?: Array<PluginRef>
  /** 現在の実験的機能をここで有効または無効にできる。これらは開発中でテストが必要な実験的機能である。実験的機能を有効にすると、その内容の詳細と、関連するディスカッションへのリンクがコンソールに表示される。 */
  flags?: Record<string, boolean>
  /** サイトをドメインのルート以外の場所でホスティングすることはよくある。たとえば Gatsby サイトが `example.com/blog/` にあるとする。この場合、サイト内のすべてのパスに接頭辞（`/blog`）を付ける必要がある。 */
  pathPrefix?: string
  /** `never` は末尾のスラッシュをすべて取り除き、`always` は追加する。`ignore` は自動では何も変更せず、一貫性を保つのはユーザーに委ねられる。デフォルトは `always` である。 */
  trailingSlash?: "always" | "never" | "ignore"
  /** 状況によっては、アセット（JavaScript や CSS などの HTML 以外のリソース）を別のドメインへデプロイしたいことがある。`assetPrefix` を使うと、別ドメインでホスティングしたアセットと Gatsby を組み合わせて使える */
  assetPrefix?: string
  /** TypeScript の型の自動生成と、より優れた GraphQL の IntelliSense により、ページへコンテンツを組み込みやすくする。true に設定すると、デフォルトの GraphQLTypegenOptions が使われる。すべてのオプションは https://www.gatsbyjs.com/docs/reference/config-files/gatsby-config/ を参照。 */
  graphqlTypegen?: boolean | GraphQLTypegenOptions
  /** Gatsby は ES6 の Promise API を使う。これに対応していないブラウザーがあるため、Gatsby はデフォルトで Promise のポリフィルを含めている。独自の Promise のポリフィルを用意したい場合は、`polyfill` を false に設定できる。*/
  polyfill?: boolean
  mapping?: Record<string, string>
  jsxRuntime?: "automatic" | "classic"
  jsxImportSource?: string
  /**
   * proxy の設定オプションを指定すると、develop サーバーは未知のリクエストを、指定したサーバーへプロキシする。
   * @see https://www.gatsbyjs.com/docs/api-proxy/
   * */
  proxy?: Proxy | Proxy[]
  /**
   * gatsby-script の off-main-thread 戦略で使うためにプロキシされる、信頼済み URL の一覧。
   * @see https://gatsby.dev/gatsby-script
   */
  partytownProxiedURLs?: Array<string>
  /** 開発サーバーに対して、より細かく柔軟なアクセスが必要になることがある。Gatsby は Express.js の開発サーバーをサイトの gatsby-config.js に公開しているので、必要に応じて Express のミドルウェアを追加できる。 */
  developMiddleware?(app: any): void
  /**
   * 特定のパスのレスポンスに独自の HTTP ヘッダーを設定できる。これにより、キャッシュの挙動を変更したり、アクセス制御を設定したりできる。HTTP ヘッダーは静的なルートとリダイレクトに適用できる。
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/headers/
   */
  headers?: Array<Header>
  /**
   * アダプターは、Gatsby の本番用の出力を受け取り、デプロイ先のプラットフォームが理解できる形に変換する役割を持つ。これにより、どのデプロイ先でも Gatsby をビルドしてデプロイしやすくなる。
   * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/adapters/
   */
  adapter?: IAdapter
}

/**
 * Node.js 向けの Gatsby API。
 *
 * @see https://www.gatsbyjs.com/docs/node-apis/
 */
export interface GatsbyNode<
  TNode extends Record<string, unknown> = Record<string, unknown>,
  TContext = Record<string, unknown>
> {
  /**
   * プラグインにページの追加を指示する。この拡張ポイントは、ノードの最初の
   * ソーシングと変換、および GraphQL スキーマの作成が完了した後にだけ
   * 呼ばれるので、データをクエリしてページを作成できる。
   *
   * @see https://www.gatsbyjs.com/docs/node-apis/#createPages
   */
  createPages?(
    args: CreatePagesArgs & {
      traceId: "initial-createPages"
    },
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * `createPages` に似ているが、Gatsby が管理して *いない* データの変更に応じて、
   * ページの作成と削除を自分で管理したいプラグインのためのものである。
   * `createPages` を実装したプラグインは、Gatsby のデータが変わるたびに
   * ページ情報を再計算するために定期的に呼ばれるが、
   * `createPagesStatefully` を実装したプラグインは呼ばれない。
   *
   * この拡張ポイントを使うプラグインの例として
   * [gatsby-plugin-page-creator](https://github.com/gatsbyjs/gatsby/tree/master/packages/gatsby-plugin-page-creator)
   * がある。このプラグインは `src/pages` ディレクトリを監視し、JS のページの
   * 追加と削除を検知する。信頼できる情報源である pages ディレクトリ内の
   * ファイルを Gatsby は把握していないため、ページをいつ追加し、いつ削除するかを
   * 知るには、プラグイン自身が状態を保持する必要がある。
   */
  createPagesStatefully?(
    args: CreatePagesArgs & {
      traceId: "initial-createPagesStatefully"
    },
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * プラグインがサイトの Babel 設定を拡張または変更できるようにする。
   * この API は、Redux のアクションを使う形への変換がまだ必要なため、
   * 2.0 より前に変更される。
   */
  onCreateBabelConfig?(
    args: CreateBabelConfigArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * gatsby develop のサーバーが起動したときに実行される。開発サーバーのアプリに
   * プロキシやミドルウェアを追加するのに役立つ
   * @param {object} $0
   * @param {Express} $0.app 開発サーバーの実行に使う [Express アプリ](https://expressjs.com/en/4x/api.html#app)
   *
   * @example
   *
   * exports.onCreateDevServer = ({ app }) => {
   *   app.get('/hello', function (req, res) {
   *     res.send('hello world')
   *   })
   * }
   */
  onCreateDevServer?(
    args: CreateDevServerArgs,
    options: PluginOptions,
    calllback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * 新しいノードが作成されたときに呼ばれる。他のプラグインが作成したノードを
   * 拡張または変換したいプラグインは、この API を実装すること。
   *
   * `createNode` と [`createNodeField`](https://www.gatsbyjs.com/docs/reference/config-files/actions/#createNodeField) の
   * ドキュメントも参照
   * @param {object} $0
   * @param {object} $0.node ノードオブジェクト。
   * @param {object} $0.actions
   * @param {function} $0.actions.createNode 新しいノードを作成する。
   * @param {function} $0.actions.createNodeField 別のノードを拡張する。新しいノードフィールドは、拡張されたノードオブジェクトの fields キーの下に置かれる。
   * @example
   * exports.onCreateNode = ({ node, getNode, actions }) => {
   *   const { createNodeField } = actions
   *
   *   if (node.internal.type === `MarkdownRemark`) {
   *     const nodePath = node.fileAbsolutePath
   *
   *     if (nodePath.match(/\/blog\//)) {
   *       const postSlug = createFilePath({
   *         node,
   *         getNode,
   *         basePath: `src/content`,
   *         trailingSlash: true,
   *       })
   *
   *       createNodeField({
   *         node,
   *         name: `slug`,
   *         value: `/blog/${postSlug}/`,
   *       })
   *     }
   *   }
   * }
   */
  onCreateNode?(
    args: CreateNodeArgs<TNode>,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * プラグインの `onCreateNode` コールバックをスケジュールする前に呼ばれる。falsy を返すと、
   * Gatsby はそのノードについて、そのプラグインの `onCreateNode` コールバックをスケジュールしない。
   * 注: この API は、他のコールバックが第 1 引数として受け取る通常の `api` を受け取らない。
   *
   * @gatsbyVersion 2.24.80
   * @example
   * exports.shouldOnCreateNode = ({node}, pluginOptions) => node.internal.type === 'Image'
   */
  shouldOnCreateNode?(args: { node: TNode }, options: PluginOptions): boolean

  /**
   * 新しいページが作成されたときに呼ばれる。この拡張 API は、他のプラグインが
   * 作成したページをプログラムから操作するのに役立つ。たとえば、
   * 末尾のスラッシュがないパスにしたい場合などである。
   *
   * この API の詳細は、ガイド [Creating and Modifying Pages](https://www.gatsbyjs.com/docs/creating-and-modifying-pages/)
   * を参照。
   */
  onCreatePage?(
    args: CreatePageArgs<TContext>,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * プラグインがサイトの webpack 設定を拡張または変更できるようにする。
   * @see https://www.gatsbyjs.com/docs/node-apis/#onCreateWebpackConfig
   */
  onCreateWebpackConfig?(
    args: CreateWebpackConfigArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** ブートストラップ処理の最後、他のすべての拡張 API が呼ばれた後に呼ばれる。 */
  onPostBootstrap?(
    args: ParentSpanPluginArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** ビルド処理の他のすべての部分が完了した後に呼ばれる、最後の拡張ポイント。 */
  onPostBuild?(
    args: BuildArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** ブートストラップ処理の最後、他のすべての拡張 API が呼ばれた後に呼ばれる。プラグインでこの API を使うつもりなら、代わりに "onPluginInit" を使うこと。 */
  onPreBootstrap?(
    args: ParentSpanPluginArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** ビルド処理の中で最初に呼ばれる拡張ポイント。ブートストラップが完了した後、ビルドのステップが始まる前に呼ばれる。 */
  onPreBuild?(
    args: BuildArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** Gatsby が自身の初期化を終え、サイトをブートストラップする準備ができたときに呼ばれる。 */
  onPreExtractQueries?(
    args: ParentSpanPluginArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * 各プロセスで（プロセスごとに 1 回）実行されるライフサイクル。アクションなどを後で使うために保存するのに使う。プラグインは "onPreBootstrap" や "onPreInit" などの他の API ではなく、これを使うべきである。onPluginInit は、クエリの並列実行に対応するために、メインプロセスとすべてのワーカーで実行されるためである。
   * @gatsbyVersion 3.9.0
   * @example
   * let createJobV2
   * exports.onPluginInit = ({ actions }) => {
   *   // Store job creation action to use it later
   *   createJobV2 = actions.createJobV2
   * }
   */
  onPluginInit?(
    args: ParentSpanPluginArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /** Gatsby の実行中に最初に呼ばれる API。プラグインが読み込まれた直後、キャッシュの初期化とブートストラップの準備の前に実行される。プラグインでこの API を使うつもりなら、代わりに "onPluginInit" を使うこと。 */
  onPreInit?(
    args: PreInitArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * JS へコンパイルする系統のプラグインに、ソースを JavaScript へ変換するよう依頼する。
   * クエリランナーが GraphQL クエリを取り出して実行できるようにするためである。
   */
  preprocessSource?(
    args: PreprocessSourceArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | string | Promise<void | string>

  /**
   * JS へコンパイルする他の言語への対応を実装するプラグインが、「解決可能な」ファイル拡張子の一覧に追加できるようにする。Gatsby はデフォルトで `.js` と `.jsx` に対応している。
   */
  resolvableExtensions?(
    args: ResolvableExtensionsArgs,
    options: PluginOptions,
    callback: PluginCallback<Array<string>>
  ): Array<string> | Promise<Array<string>>

  /**
   * GraphQL スキーマの作成中に呼ばれる。プラグインは、データノードから
   * 作成された型に新しいフィールドを追加できる。型ごとに個別に
   * 呼ばれる。
   *
   * この関数は
   * [GraphQLFieldConfigMap](https://graphql.org/graphql-js/type/#graphqlobjecttype)
   * の形のオブジェクトを返すこと。それが、Gatsby がデータノードから推論したフィールドに追加される。
   *
   * *注:* GraphQL の型は `gatsby/graphql` から import し、`graphql` パッケージを
   * プロジェクトやプラグインの依存に追加しないこと。Schema must
   * contain unique named types but contains multiple types named というエラーを避けるためである。
   * `gatsby/graphql` は、組み込みの GraphQL の型すべてと、`graphQLJSON` 型を
   * export している。
   *
   * 多くのトランスフォーマープラグインは、引数を取るフィールドを追加するためにこれを使う。
   *
   * @see https://www.gatsbyjs.com/docs/node-apis/#setFieldsOnGraphQLNodeType
   */
  setFieldsOnGraphQLNodeType?(
    args: SetFieldsOnGraphQLNodeTypeArgs,
    options: PluginOptions,
    callback: PluginCallback<any>
  ): any

  /**
   * プラグインにノードのソーシングを指示する拡張ポイント。この API は Gatsby の
   * ブートストラップの過程で呼ばれる。ソースプラグインはこのフックを使ってノードを作成する。
   * この API はプラグインごとにちょうど 1 回（およびサイトの
   * `gatsby-config.js` ファイルに対して 1 回）呼ばれる。このフックを `gatsby-node.js` で
   * 定義した場合は、すべてのソースプラグインがノードの作成を終えた後に、
   * ちょうど 1 回呼ばれる。
   *
   * @see https://www.gatsbyjs.com/docs/node-apis/#sourceNodes
   */
  sourceNodes?(
    args: SourceNodesArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * GraphQL スキーマに独自のフィールドリゾルバーを追加する。
   *
   * フィールドの設定を渡して型に新しいフィールドを追加したり、既存のフィールドに
   * リゾルバー関数を追加したりできる。
   *
   * 注意点:
   * * フィールドの型の上書きは許可されていない。代わりに `createTypes`
   *   アクションを使うこと。サードパーティのスキーマから追加された型のように
   *   それができない場合は、フィールドの型の上書きが許可される。
   * * 新しいフィールドは `filter` と `sort` の入力型では使えない。それが必要な場合は、
   *   `createTypes` で定義した型を拡張すること。
   * * フィールドの設定では、型を文字列で参照できる。
   * * 既存のフィールドリゾルバーを持つフィールドを拡張する場合、元の
   *   リゾルバー関数は `info.originalResolver` から利用できる。
   * * `createResolvers` API は、スキーマ生成の最後のステップとして呼ばれる。
   *   そのため、`schema` プロパティでは中間のスキーマが提供される。
   *   リゾルバー関数の中では、最終的に構築されたスキーマに
   *   `info.schema` からアクセスすることを推奨する。
   * * 内部のクエリ機能すべてを含む Gatsby のデータレイヤーは、
   *   [`context.nodeModel`](/docs/node-model/) で公開されている。ノードストアは
   *   `findOne`、`getNodeById`、`getNodesByIds` で直接クエリでき、
   *   より高度なクエリは `findAll` で組み立てられる。
   * * ルートの `Query` 型にフィールドを追加できる。
   * * リゾルバーの第 1 引数（下の例では `source`。
   *   `parent` や `root` と呼ばれることも多い）を使うときは、フィールド
   *   リゾルバーが 1 つのクエリの中で複数回呼ばれうることに注意する。たとえば、
   *   フィールドが入力のフィルターと選択セットの両方にある場合である。つまり、
   *   `source` の外部キーのフィールドは、解決済みのことも未解決のこともある。
   *
   * より詳しい例は [`using-type-definitions`](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-type-definitions) を参照。
   *
   * @see https://www.gatsbyjs.com/docs/reference/config-files/gatsby-node/#createResolvers
   */
  createResolvers?(
    args: CreateResolversArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * 型定義やフィールド拡張を作成したり、サードパーティのスキーマを追加したりして、Gatsby の GraphQL スキーマをカスタマイズする。
   * createTypes、createFieldExtension、addThirdPartySchema の各アクションは、この API でだけ利用できる。
   *
   * 使い方の詳細は、アクションのドキュメントを参照。
   *
   * この API はスキーマ生成の直前に実行される。追加されたサードパーティの型をカスタマイズするなど、
   * 生成されたスキーマを変更する場合は、createResolvers API を使うこと。
   * @see https://www.gatsbyjs.com/docs/node-apis/#createSchemaCustomization
   */
  createSchemaCustomization?(
    args: CreateSchemaCustomizationArgs,
    options: PluginOptions,
    callback: PluginCallback<void>
  ): void | Promise<void>

  /**
   * プラグインが取りうるオプションの Joi スキーマを追加する。
   * 現在は実験的で、デフォルトでは有効になっていない。
   */
  pluginOptionsSchema?(args: PluginOptionsSchemaArgs): ObjectSchema
}

/**
 * Gatsby のブラウザー API。
 *
 * @see https://www.gatsbyjs.com/docs/browser-apis/
 */
export interface GatsbyBrowser<
  DataType = Record<string, unknown>,
  PageContext = Record<string, unknown>,
  LocationState = WindowLocation["state"]
> {
  disableCorePrefetching?(
    args: BrowserPluginArgs,
    options: PluginOptions
  ): boolean
  onClientEntry?(args: BrowserPluginArgs, options: PluginOptions): void
  onInitialClientRender?(args: BrowserPluginArgs, options: PluginOptions): void
  onPostPrefetchPathname?(
    args: PrefetchPathnameArgs,
    options: PluginOptions
  ): void
  onPreRouteUpdate?(args: RouteUpdateArgs, options: PluginOptions): void
  onPrefetchPathname?(args: PrefetchPathnameArgs, options: PluginOptions): void
  onRouteUpdate?(args: RouteUpdateArgs, options: PluginOptions): void
  onRouteUpdateDelayed?(
    args: RouteUpdateDelayedArgs,
    options: PluginOptions
  ): void
  onServiceWorkerActive?(args: ServiceWorkerArgs, options: PluginOptions): void
  onServiceWorkerInstalled?(
    args: ServiceWorkerArgs,
    options: PluginOptions
  ): void
  onServiceWorkerRedundant?(
    args: ServiceWorkerArgs,
    options: PluginOptions
  ): void
  onServiceWorkerUpdateFound?(
    args: ServiceWorkerArgs,
    options: PluginOptions
  ): void
  onServiceWorkerUpdateReady?(
    args: ServiceWorkerArgs,
    options: PluginOptions
  ): void
  registerServiceWorker?(
    args: BrowserPluginArgs,
    options: PluginOptions
  ): boolean
  replaceHydrateFunction?(
    args: BrowserPluginArgs,
    options: PluginOptions
  ): Renderer
  shouldUpdateScroll?(
    args: ShouldUpdateScrollArgs,
    options: PluginOptions
  ): boolean | [number, number] | string
  wrapPageElement?(
    args: WrapPageElementBrowserArgs<DataType, PageContext, LocationState>,
    options: PluginOptions
  ): React.ReactElement
  wrapRootElement?(
    args: WrapRootElementBrowserArgs,
    options: PluginOptions
  ): React.ReactElement
}

/**
 * Gatsby のサーバーサイドレンダリング API。
 *
 * @see https://www.gatsbyjs.com/docs/ssr-apis/
 */
export interface GatsbySSR<
  DataSet = Record<string, unknown>,
  PageContext = Record<string, unknown>
> {
  /**
   * HTML のビルド中に Gatsby がページをサーバーレンダリングするたびに呼ばれる。
   * `html.js` でレンダリングする head のコンポーネントを置き換えられる。
   * 他のプラグインが追加したスクリプトやスタイルを並べ替える必要があるときに役立つ。
   * @example
   * // Move Typography.js styles to the top of the head section so they're loaded first.
   * exports.onPreRenderHTML = ({ getHeadComponents, replaceHeadComponents }) => {
   *   const headComponents = getHeadComponents()
   *   headComponents.sort((x, y) => {
   *     if (x.key === 'TypographyStyle') {
   *       return -1
   *     } else if (y.key === 'TypographyStyle') {
   *       return 1
   *     }
   *     return 0
   *   })
   *   replaceHeadComponents(headComponents)
   * }
   */
  onPreRenderHTML?(args: PreRenderHTMLArgs, options: PluginOptions): void

  /**
   * HTML のビルド中に Gatsby がページをサーバーレンダリングするたびに呼ばれる。
   * `html.js` でレンダリングする head と body のコンポーネントを設定できる。
   *
   * Gatsby は HTML を 2 パスでレンダリングする。まず各ページの body だけを
   * レンダリングし、その結果の body の HTML 文字列を `body` prop として
   * `html.js` へ渡してレンダリングを完了する。
   *
   * 独自のコンポーネントを `html.js` へ渡せると便利なことが多い。
   * たとえば、サーバーレンダリングに対応した React.js のライブラリでは、
   * レンダリング中に生成したデータを取り出して HTML に追加するパターンが
   * 非常によく使われる。
   *
   * `replaceRenderer` よりも、この API を使うことが望ましい。
   * この API は複数のプラグインが実装できるが、サーバーレンダリングを
   * 引き受けられるプラグインは 1 つだけだからである。ただし、プラグインが
   * サーバーレンダリングを引き受ける必要がある場合は、そちらを使うこと
   * @example
   * const { Helmet } = require("react-helmet")
   *
   * exports.onRenderBody = (
   *   { setHeadComponents, setHtmlAttributes, setBodyAttributes },
   *   pluginOptions
   * ) => {
   *   const helmet = Helmet.renderStatic()
   *   setHtmlAttributes(helmet.htmlAttributes.toComponent())
   *   setBodyAttributes(helmet.bodyAttributes.toComponent())
   *   setHeadComponents([
   *     helmet.title.toComponent(),
   *     helmet.link.toComponent(),
   *     helmet.meta.toComponent(),
   *     helmet.noscript.toComponent(),
   *     helmet.script.toComponent(),
   *     helmet.style.toComponent(),
   *   ])
   * }
   */
  onRenderBody?(args: RenderBodyArgs, options: PluginOptions): void

  /**
   * デフォルトのサーバーレンダラーを置き換える。Redux や css-in-js ライブラリなど、
   * サーバーレンダリングに独自のセットアップが必要なものと統合するときに役立つ。
   * @example
   * // From gatsby-plugin-glamor
   * const { renderToString } = require("react-dom/server")
   * const inline = require("glamor-inline")
   *
   * exports.replaceRenderer = ({ bodyComponent, replaceBodyHTMLString }) => {
   *   const bodyHTML = renderToString(bodyComponent)
   *   const inlinedHTML = inline(bodyHTML)
   *
   *   replaceBodyHTMLString(inlinedHTML)
   * }
   */
  replaceRenderer?(
    args: ReplaceRendererArgs,
    options: PluginOptions
  ): void | Promise<void>

  /**
   * プラグインがページ要素をラップできるようにする。
   *
   * ページが切り替わってもアンマウントされないラッパーコンポーネントを、
   * ページの周りに配置するときに役立つ。Provider コンポーネントを設定する場合は `wrapRootElement` を使うこと。
   *
   * _注:_ [Browser API にも同等のフックがある](https://www.gatsbyjs.com/docs/browser-apis/#wrapPageElement)
   * @example
   * const React = require("react")
   * const Layout = require("./src/components/layout")
   *
   * exports.wrapPageElement = ({ element, props }) => {
   *   // props provide same data to Layout as Page element will get
   *   // including location, data, etc - you don't need to pass it
   *   return <Layout {...props}>{element}</Layout>
   * }
   */
  wrapPageElement?(
    args: WrapPageElementNodeArgs<DataSet, PageContext>,
    options: PluginOptions
  ): React.ReactElement

  /**
   * プラグインがルート要素をラップできるようにする。
   *
   * アプリケーション全体をラップする Provider コンポーネントを設定するときに役立つ。
   * ページの周りに常駐する UI 要素を配置する場合は `wrapPageElement` を使うこと。
   *
   * _注:_ [Browser API にも同等のフックがある](https://www.gatsbyjs.com/docs/browser-apis/#wrapRootElement)
   * @example
   * const React = require("react")
   * const { Provider } = require("react-redux")
   *
   * const createStore = require("./src/state/createStore")
   * const store = createStore()
   *
   * exports.wrapRootElement = ({ element }) => {
   *   return (
   *     <Provider store={store}>
   *       {element}
   *     </Provider>
   *   )
   * }
   */
  wrapRootElement?(
    args: WrapRootElementNodeArgs,
    options: PluginOptions
  ): React.ReactElement
}

export interface PluginOptions {
  plugins: unknown[]
  [key: string]: unknown
}

export type PluginCallback<R = any> = (err: Error | null, result?: R) => void

export interface CreatePagesArgs extends ParentSpanPluginArgs {
  graphql<TData, TVariables = any>(
    query: string,
    variables?: TVariables
  ): Promise<{
    errors?: any
    data?: TData
  }>
  traceId: string
  waitForCascadingActions: boolean
}

type GatsbyStages =
  | "develop"
  | "develop-html"
  | "build-javascript"
  | "build-html"

export interface CreateBabelConfigArgs extends ParentSpanPluginArgs {
  stage: GatsbyStages
}

export interface CreateDevServerArgs extends ParentSpanPluginArgs {
  app: any
}

export interface CreateNodeArgs<
  TNode extends Record<string, unknown> = Record<string, unknown>
> extends ParentSpanPluginArgs {
  node: Node & TNode
  traceId: string
  traceTags: {
    nodeId: string
    nodeType: string
  }
}

export interface CreatePageArgs<TContext = Record<string, unknown>>
  extends ParentSpanPluginArgs {
  page: Page<TContext>
  traceId: string
}

export interface CreateWebpackConfigArgs extends ParentSpanPluginArgs {
  getConfig: Function
  stage: GatsbyStages
  rules: WebpackRules
  loaders: WebpackLoaders
  plugins: WebpackPlugins
}

export interface PreprocessSourceArgs extends ParentSpanPluginArgs {
  filename: string
  contents: string
}

export interface ResolvableExtensionsArgs extends ParentSpanPluginArgs {
  traceId: "initial-resolvableExtensions"
}

export interface SetFieldsOnGraphQLNodeTypeArgs extends ParentSpanPluginArgs {
  type: {
    name: string
    nodes: any[]
  }
  traceId: "initial-setFieldsOnGraphQLNodeType"
}

export interface GatsbyGraphQLObjectType {
  kind: "OBJECT"
  config: ComposeObjectTypeConfig<any, any>
}

export interface GatsbyGraphQLInputObjectType {
  kind: "INPUT_OBJECT"
  config: ComposeInputObjectTypeConfig
}

export interface GatsbyGraphQLUnionType {
  kind: "UNION"
  config: ComposeUnionTypeConfig<any, any>
}

export interface GatsbyGraphQLInterfaceType {
  kind: "INTERFACE"
  config: ComposeInterfaceTypeConfig<any, any>
}

export interface GatsbyGraphQLEnumType {
  kind: "ENUM"
  config: ComposeEnumTypeConfig
}

export interface GatsbyGraphQLScalarType {
  kind: "SCALAR"
  config: ComposeScalarTypeConfig
}

export type GatsbyGraphQLType =
  | GatsbyGraphQLObjectType
  | GatsbyGraphQLInputObjectType
  | GatsbyGraphQLUnionType
  | GatsbyGraphQLInterfaceType
  | GatsbyGraphQLEnumType
  | GatsbyGraphQLScalarType

export interface NodePluginSchema {
  buildObjectType(
    config: ComposeObjectTypeConfig<any, any>
  ): GatsbyGraphQLObjectType
  buildUnionType(
    config: ComposeUnionTypeConfig<any, any>
  ): GatsbyGraphQLUnionType
  buildInterfaceType(
    config: ComposeInterfaceTypeConfig<any, any>
  ): GatsbyGraphQLInterfaceType
  buildInputObjectType(
    config: ComposeInputObjectTypeConfig
  ): GatsbyGraphQLInputObjectType
  buildEnumType(config: ComposeEnumTypeConfig): GatsbyGraphQLEnumType
  buildScalarType(config: ComposeScalarTypeConfig): GatsbyGraphQLScalarType
}
export interface PreInitArgs extends ParentSpanPluginArgs {
  actions: Actions
}

export interface SourceNodesArgs extends ParentSpanPluginArgs {
  traceId: "initial-sourceNodes"
  waitForCascadingActions: boolean
  webhookBody: any
}

export interface CreateResolversArgs extends ParentSpanPluginArgs {
  intermediateSchema: object
  createResolvers: Function
  traceId: "initial-createResolvers"
}

export interface CreateSchemaCustomizationArgs extends ParentSpanPluginArgs {
  traceId: "initial-createSchemaCustomization"
}

export interface PreRenderHTMLArgs {
  getHeadComponents: () => React.ReactNode[]
  replaceHeadComponents: (comp: React.ReactNode[]) => void
  getPreBodyComponents: () => React.ReactNode[]
  replacePreBodyComponents: (comp: React.ReactNode[]) => void
  getPostBodyComponents: () => React.ReactNode[]
  replacePostBodyComponents: (comp: React.ReactNode[]) => void
  pathname: string
}

type ReactProps<T extends Element> = React.DetailedHTMLProps<
  React.HTMLAttributes<T>,
  T
>
export interface RenderBodyArgs {
  loadPageDataSync: (pathname: string) => { result: Record<string, unknown> }
  pathname: string
  setHeadComponents: (comp: React.ReactNode[]) => void
  setHtmlAttributes: (attr: ReactProps<HTMLHtmlElement>) => void
  setBodyAttributes: (attr: ReactProps<HTMLBodyElement>) => void
  setPreBodyComponents: (comp: React.ReactNode[]) => void
  setPostBodyComponents: (comp: React.ReactNode[]) => void
  setBodyProps: Function
}

export interface ReplaceRendererArgs {
  replaceBodyHTMLString: (str: string) => void
  bodyComponent: React.ReactNode
  setHeadComponents: (comp: React.ReactNode[]) => void
  setHtmlAttributes: (attr: ReactProps<HTMLHtmlElement>) => void
  setBodyAttributes: (attr: ReactProps<HTMLBodyElement>) => void
  setPreBodyComponents: (comp: React.ReactNode[]) => void
  setPostBodyComponents: (comp: React.ReactNode[]) => void
  setBodyProps: Function
  pathname: string
}

export interface WrapPageElementNodeArgs<
  DataType = Record<string, unknown>,
  PageContextType = Record<string, unknown>
> {
  element: React.ReactElement
  props: PageProps<DataType, PageContextType>
}

export interface WrapRootElementNodeArgs {
  element: React.ReactElement
  pathname: string
}

export interface ParentSpanPluginArgs extends NodePluginArgs {
  parentSpan: Span
}

export interface NodePluginArgs {
  /**
   * リソースの URL に接頭辞を付けるために使う。`pathPrefix` は空文字列か、
   * スラッシュで始まりスラッシュで終わらないパスのどちらかになる。`gatsby-config.js` で
   * `assetPrefix` と `pathPrefix` の両方を渡した場合、`pathPrefix` は
   * `<assetPrefix>/<pathPrefix>` になる。
   *
   * パスの接頭辞の詳細は [Adding a Path Prefix](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/path-prefix/)
   * のページを参照。
   */
  pathPrefix: string

  /**
   * `gatsby-config.js` で渡した `pathPrefix` と同じものである。
   * `pathPrefix` を渡していない場合は空文字列になる。
   * assetPrefix を使っている場合は、pathPrefix の代わりにこれを使うと、`gatsby-config.js` で設定した文字列を受け取れる。
   * `assetPrefix` は含まれない。
   */
  basePath: string

  /**
   * Gatsby の内部状態をプログラムから変更するための関数の集まり。
   */
  actions: Actions

  /**
   * ノードを作成したプラグインから、そのノードのコンテンツを取得する。
   *
   * @example
   * module.exports = async function onCreateNode(
   *   { node, loadNodeContent, actions, createNodeId }
   * ) {
   *   if (node.internal.mediaType === 'text/markdown') {
   *     const { createNode, createParentChildLink } = actions
   *     const textContent = await loadNodeContent(node)
   *     // process textContent and create child nodes
   *   }
   * }
   */
  loadNodeContent(this: void, node: Node): Promise<string>

  /**
   * アプリケーションの状態に使う内部の redux の state。どうしても必要な場合を除き、
   * 使わないこと。store はプライベートな API とみなされ、どのバージョンでも
   * 変わりうる。
   */
  store: Store

  /**
   * 内部のイベントエミッターとリスナー。どうしても必要な場合を除き、使わないこと。
   * emitter はプライベートな API とみなされ、どのバージョンでも変わりうる。
   */
  emitter: EventEmitter

  /**
   * すべてのノードの配列を取得する。
   *
   * @returns ノードの配列。
   * @example
   * const allNodes = getNodes()
   */
  getNodes(this: void): Node[]

  /**
   * 指定した ID のノードを 1 つ取得する。
   * graphql のリゾルバーでは使わないこと。
   * `getNodeAndSavePathDependency` を参照
   *
   * @param id ノードの id。
   * @returns ノードのインスタンス 1 つ。
   * @example
   * const node = getNode(id)
   */
  getNode(this: void, id: string): Node | undefined

  /**
   * 指定した型のノードの配列を取得する。
   * @param type ノードの型
   * @returns ノードの配列。
   *
   * @example
   * const markdownNodes = getNodesByType(`MarkdownRemark`)
   */
  getNodesByType(this: void, type: string): Node[]

  /**
   * ユーザーへ情報を出力するためのユーティリティ一式
   */
  reporter: Reporter

  /**
   * 指定した ID のノードを 1 つ取得し、指定したパスへの依存関係を作成する。
   * クエリ結果の依存関係を追跡できるよう、graphql のリゾルバーでは `getNode` の代わりに
   * これを使うこと。使わない場合、ノードが変わっても Gatsby はクエリを再実行せず、
   * クエリ結果が古いままになる。詳細は
   * [Page -> Node Dependency Tracking](/docs/page-node-dependencies/)
   * を参照。
   * @param id ノードの id。
   * @param path ノードのパス。
   * @returns ノードのインスタンス 1 つ。
   */
  getNodeAndSavePathDependency(this: void, id: string, path: string): Node

  /**
   * 時間、メモリ、CPU を多く使う処理の結果を永続化するための
   * キーバリューストア。すべての関数は非同期で、promise を返す。
   */
  cache: GatsbyCache

  /**
   * 名前を指定してキャッシュのインスタンスを取得する。サブプラグインを受け付けるプラグインだけが使うこと。
   * @param id ノードの id
   * @returns [cache](https://www.gatsbyjs.com/docs/reference/config-files/node-api-helpers/#cache) の節を参照。
   */
  getCache(this: void, id: string): GatsbyCache

  /**
   * グローバルに一意で安定したノード ID を生成するのに役立つユーティリティ関数。
   * 同じ入力を使っても、プラグインが異なれば異なる ID を
   * 生成する。
   *
   * @returns UUIDv5 の ID 文字列
   * @example
   * const node = {
   *   id: createNodeId(`${backendData.type}${backendData.id}`),
   *   ...restOfNodeData
   * }
   */
  createNodeId(this: void, input: string): string

  /**
   * 文字列またはオブジェクトから、安定したコンテンツダイジェストを作成する。
   * この関数の結果は、ノードの `internal.contentDigest` フィールドの設定に
   * 使える。Gatsby はこのフィールドの値を使って、コンテンツが変わったときに
   * 古いデータを無効化する。
   * @param input
   * @returns ハッシュ文字列
   * @example
   * const node = {
   *   ...nodeData,
   *   internal: {
   *     type: `TypeOfNode`,
   *     contentDigest: createContentDigest(nodeData)
   *   }
   * }
   */
  createContentDigest(this: void, input: string | object): string

  /**
   * プラグインにより詳細なトレースを追加できるユーティリティ一式。
   * 詳細は
   * [Performance tracing](https://www.gatsbyjs.com/docs/performance-tracing)
   * のページを参照。
   */
  tracing: Tracing
  schema: NodePluginSchema
  [key: string]: unknown
}

interface ActionPlugin {
  name: string
}

interface CreateNodeFieldArgs {
  node: Node
  name: string
  value: string
}

interface ActionOptions {
  [key: string]: unknown
}

export interface BuildArgs extends ParentSpanPluginArgs {
  graphql<TData, TVariables = any>(
    query: string,
    variables?: TVariables
  ): Promise<{
    errors?: any
    data?: TData
  }>
}

export interface Actions {
  /** @see https://www.gatsbyjs.com/docs/actions/#deletePage */
  deletePage(this: void, args: { path: string; component: string }): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createPage */
  createPage<TContext = Record<string, unknown>>(
    this: void,
    args: Page<TContext>,
    plugin?: ActionPlugin,
    option?: ActionOptions
  ): void

  /** @see https://www.gatsbyjs.com/docs/reference/config-files/actions/#createSlice */
  createSlice<TContext = Record<string, unknown>>(
    this: void,
    args: SliceInput<TContext>,
    plugin?: ActionPlugin,
    option?: ActionOptions
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#deleteNode */
  deleteNode(node: NodeInput, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createNode */
  createNode<TNode = Record<string, unknown>>(
    this: void,
    node: NodeInput & TNode,
    plugin?: ActionPlugin,
    options?: ActionOptions
  ): void | Promise<void>

  /** @see https://www.gatsbyjs.com/docs/actions/#touchNode */
  touchNode(node: NodeInput, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createNodeField */
  createNodeField(
    this: void,
    args: {
      node: Node
      name?: string
      value: any
    },
    plugin?: ActionPlugin,
    options?: ActionOptions
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createParentChildLink */
  createParentChildLink(
    this: void,
    args: { parent: Node; child: NodeInput },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/reference/config-files/actions/#unstable_createNodeManifest */
  unstable_createNodeManifest(
    this: void,
    args: {
      manifestId: string
      node: Node
      updatedAtUTC?: string | number
    },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setRequestHeaders */
  setRequestHeaders(
    this: void,
    args: { domain: string; headers: Record<string, string> },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setWebpackConfig */
  setWebpackConfig(this: void, config: object, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#replaceWebpackConfig */
  replaceWebpackConfig(this: void, config: object, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setBabelOptions */
  setBabelOptions(this: void, options: object, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setBabelPlugin */
  setBabelPlugin(
    this: void,
    config: { name: string; options: object },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setBabelPreset */
  setBabelPreset(
    this: void,
    config: { name: string; options: object },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createJob */
  createJob(
    this: void,
    job: Record<string, unknown> & { id: string },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createJobV2 */
  createJobV2(
    this: void,
    job: {
      name: string
      inputPaths: string[]
      outputDir: string
      args: Record<string, unknown>
    },
    plugin?: ActionPlugin
  ): Promise<unknown>

  /** @see https://www.gatsbyjs.com/docs/actions/#addGatsbyImageSourceUrl */
  addGatsbyImageSourceUrl(this: void, sourceUrl: string): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setJob */
  setJob(
    this: void,
    job: Record<string, unknown> & { id: string },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#endJob */
  endJob(this: void, job: { id: string }, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#setPluginStatus */
  setPluginStatus(
    this: void,
    status: Record<string, unknown>,
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createRedirect */
  createRedirect(
    this: void,
    redirect: {
      fromPath: string
      isPermanent?: boolean
      toPath: string
      redirectInBrowser?: boolean
      force?: boolean
      statusCode?: number
      ignoreCase?: boolean
      [key: string]: unknown
    },
    plugin?: ActionPlugin
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#addThirdPartySchema */
  addThirdPartySchema(
    this: void,
    args: { schema: object },
    plugin?: ActionPlugin,
    traceId?: string
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createTypes */
  createTypes(
    this: void,
    types:
      | string
      | GraphQLOutputType
      | GatsbyGraphQLType
      | Array<string | GraphQLOutputType | GatsbyGraphQLType>,
    plugin?: ActionPlugin,
    traceId?: string
  ): void

  /** @see https://www.gatsbyjs.com/docs/actions/#createFieldExtension */
  createFieldExtension(
    this: void,
    extension: object,
    plugin?: ActionPlugin,
    traceId?: string
  ): void

  printTypeDefinitions(
    this: void,
    options: {
      path?: string
      include?: { types?: Array<string>; plugins?: Array<string> }
      exclude?: { types?: Array<string>; plugins?: Array<string> }
      withFieldTypes?: boolean
    },
    plugin?: ActionPlugin,
    traceId?: string
  ): void

  /**
   * この関数を呼び出したソースプラグインを、ステートフルとしてマークする。これを呼び出したプラグインについては、Gatsby は古いノードの確認を行わない。
   */
  enableStatefulSourceNodes?(this: void, plugin?: ActionPlugin): void

  /** @see https://www.gatsbyjs.com/docs/actions/#addRemoteFileAllowedUrl */
  addRemoteFileAllowedUrl?(
    this: void,
    url: string | Array<string>,
    plugin?: ActionPlugin,
    traceId?: string
  ): void
}

export interface Store {
  dispatch: Function
  subscribe: Function
  getState: Function
  replaceReducer: Function
}

export type ActivityTracker = {
  start(): () => void
  end(): () => void
  span: Object
  setStatus(status: string): void
  panic: (errorMeta: string | Object, error?: Object) => never
  panicOnBuild: (errorMeta: string | Object, error?: Object) => void
}

export type ProgressActivityTracker = Omit<ActivityTracker, "end"> & {
  tick(increment?: number): void
  done(): void
  total: number
}

export type ActivityArgs = {
  parentSpan?: Object
  id?: string
}

/**
 * @deprecated 代わりに `GatsbyCache` を使うこと
 */
export interface Cache {
  name: string
  store: {
    create: Function
  }
  cache: {
    getAndPassUp: Function
    wrap: Function
    set: Function
    mset: Function
    get: Function
    mget: Function
    del: Function
    reset: Function
  }
}

export interface GatsbyCache {
  name: string
  directory: string
  /**
   * キャッシュされた値を取得する
   * @param key キャッシュのキー
   * @returns キャッシュされた値で解決される Promise
   * @example
   * const value = await cache.get(`unique-key`)
   */
  get(key: string): Promise<any>

  /**
   * 値をキャッシュする
   * @param key キャッシュのキー
   * @param value キャッシュする値
   * @returns キャッシュされた値で解決される Promise
   * @example
   * await cache.set(`unique-key`, value)
   */
  set(key: string, value: any): Promise<any>

  /**
   * キャッシュされた値を削除する
   * @param {string} key キャッシュのキー
   * @returns {Promise<void>} キーがキャッシュから削除されると解決される Promise
   * @example
   * await cache.del(`unique-key`)
   */
  del(key: string): Promise<void>
}

export interface Tracing {
  tracer: object
  parentSpan: object
  startSpan: Function
}

export interface PackageJson {
  name?: string
  description?: string
  version?: string
  main?: string
  author?:
    | string
    | {
        name: string
        email: string
      }
  license?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: Array<string>
  keywords?: string[]
}

export interface WebpackRules {
  js: Function
  mjs: Function
  eslint: Function
  yaml: Function
  fonts: Function
  images: Function
  media: Function
  miscAssets: Function
  css: Function
  cssModules: Function
  postcss: Function
  [key: string]: Function
}

export interface WebpackLoaders {
  json: Function
  yaml: Function
  null: Function
  raw: Function
  style: Function
  miniCssExtract: Function
  css: Function
  postcss: Function
  file: Function
  url: Function
  js: Function
  eslint: Function
  imports: Function
  exports: Function
  [key: string]: Function
}

export interface WebpackPlugins {
  normalModuleReplacement: Function
  contextReplacement: Function
  ignore: Function
  watchIgnore: Function
  banner: Function
  prefetch: Function
  automaticPrefetch: Function
  define: Function
  provide: Function
  hotModuleReplacement: Function
  sourceMapDevTool: Function
  evalSourceMapDevTool: Function
  evalDevToolModule: Function
  cache: Function
  extendedAPI: Function
  externals: Function
  jsonpTemplate: Function
  libraryTemplate: Function
  loaderTarget: Function
  memoryOutputFile: Function
  progress: Function
  setVarMainTemplate: Function
  umdMainTemplate: Function
  noErrors: Function
  noEmitOnErrors: Function
  newWatching: Function
  environment: Function
  dll: Function
  dllReference: Function
  loaderOptions: Function
  namedModules: Function
  namedChunks: Function
  hashedModuleIds: Function
  moduleFilenameH: Function
  aggressiveMerging: Function
  aggressiveSplitting: Function
  splitChunks: Function
  chunkModuleIdRange: Function
  dedupe: Function
  limitChunkCount: Function
  minChunkSize: Function
  occurrenceOrder: Function
  moduleConcatenation: Function
  minifyJs: Function
  minifyCss: Function
  extractText: Function
  moment: Function
  [key: string]: Function
}

export interface PrefetchPathnameArgs extends BrowserPluginArgs {
  pathname: string
}

export interface RouteUpdateArgs extends BrowserPluginArgs {
  location: Location
  prevLocation: Location | null
}

export interface ShouldUpdateScrollArgs extends BrowserPluginArgs {
  prevRouterProps?: {
    location: Location
  }
  pathname: string
  routerProps: {
    location: Location & NavigateOptions<any>
  }
  getSavedScrollPosition: Function
}

export interface WrapPageElementBrowserArgs<
  DataType = Record<string, unknown>,
  PageContextType = Record<string, unknown>,
  LocationState = WindowLocation["state"]
> extends BrowserPluginArgs {
  element: React.ReactElement
  props: PageProps<DataType, PageContextType, LocationState>
}

export interface WrapRootElementBrowserArgs extends BrowserPluginArgs {
  element: React.ReactElement
  pathname: string
}

export interface BrowserPluginArgs {
  getResourceURLsForPathname: Function
  [key: string]: unknown
}

export interface RouteUpdateDelayedArgs extends BrowserPluginArgs {
  location: Location
}

export interface ServiceWorkerArgs extends BrowserPluginArgs {
  serviceWorker: ServiceWorkerRegistration
}

export interface NodeInput {
  id: string
  parent?: string | null
  children?: string[]
  internal: {
    type: string
    mediaType?: string
    content?: string
    contentDigest: string
    description?: string
    contentFilePath?: string
  }
  [key: string]: unknown
}

export interface Node extends NodeInput {
  parent: string | null
  children: string[]
  internal: NodeInput["internal"] & {
    owner: string
  }
  [key: string]: unknown
}

export interface Page<TContext = Record<string, unknown>> {
  path: string
  matchPath?: string
  component: string
  context?: TContext
  ownerNodeId?: string
  defer?: boolean
  slices?: Record<string, string>
}

export interface SliceInput<TContext = Record<string, unknown>> {
  id: string
  component: string
  context?: TContext
}

export interface IPluginRefObject {
  resolve: string
  options?: IPluginRefOptions
  parentDir?: string
  /** @private プラグインのインストール時に create-gatsby が使う内部のキー。定義する必要はなく、削除してよい。 */
  __key?: string
}

export type PluginRef = string | IPluginRefObject

export interface IPluginRefOptions {
  plugins?: PluginRef[]
  path?: string
  [option: string]: unknown
}

export interface PluginOptionsSchemaArgs {
  Joi: PluginOptionsSchemaJoi
}

/**
 * レスポンスの本文を送信する
 */
type Send<T> = (body: T) => void

/**
 * Gatsby Function のルートのレスポンス
 */
export interface GatsbyFunctionResponse<T = any> extends ServerResponse {
  /**
   * レスポンスで `any` のデータを送信する
   */
  send: Send<T>
  /**
   * レスポンスで `JSON` のデータを送信する
   */
  json: Send<T>
  /**
   * レスポンスの HTTP ステータスコードを設定する
   */
  status: (statusCode: number) => GatsbyFunctionResponse<T>
  redirect(url: string): GatsbyFunctionResponse<T>
  redirect(status: number, url: string): GatsbyFunctionResponse<T>
}

/**
 * Gatsby Function のルートのリクエスト
 */
export interface GatsbyFunctionRequest<ReqBody = any> extends IncomingMessage {
  /**
   * URL のクエリパラメーター（URL の ? より後ろ）の値を持つオブジェクト
   */
  query: Record<string, string>

  /**
   * ルートパラメーターの値を持つオブジェクト
   */
  params: Record<string, string>
  body: ReqBody
  /**
   * ヘッダーから得た `cookies` のオブジェクト
   */
  cookies: Record<string, string>
  /**
   * アダプターが完全な生の URL を保存するための任意のフィールド
   */
  rawUrl?: string
}

export interface GatsbyFunctionBodyParserCommonMiddlewareConfig {
  type?: string
  limit?: string | number
}

export interface GatsbyFunctionBodyParserUrlencodedConfig
  extends GatsbyFunctionBodyParserCommonMiddlewareConfig {
  extended: boolean
}

export interface GatsbyFunctionBodyParserConfig {
  json?: GatsbyFunctionBodyParserCommonMiddlewareConfig
  raw?: GatsbyFunctionBodyParserCommonMiddlewareConfig
  text?: GatsbyFunctionBodyParserCommonMiddlewareConfig
  urlencoded?: GatsbyFunctionBodyParserUrlencodedConfig
}

export interface GatsbyFunctionConfig {
  bodyParser?: GatsbyFunctionBodyParserConfig
}

declare module NodeJS {
  interface Global {
    __GATSBY: {
      buildId: string
      root: string
    }
  }
}
