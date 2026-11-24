import type { TrailingSlash } from "gatsby-page-utils"
import type { Express } from "express"
import { IProgram, Stage } from "../commands/types"
import { GraphQLFieldExtensionDefinition } from "../schema/extensions"
import {
  DocumentNode,
  GraphQLSchema,
  DefinitionNode,
  SourceLocation,
} from "graphql"
import { SchemaComposer } from "graphql-compose"
import { IGatsbyCLIState } from "gatsby-cli/src/reporter/redux/types"
import { ThunkAction } from "redux-thunk"
import { InternalJob, JobResultInterface } from "../utils/jobs/manager"
import { ITypeMetadata } from "../schema/infer/inference-metadata"
import { Span } from "opentracing"
import { ICollectedSlices } from "../utils/babel/find-slices"
import type {
  IAdapter,
  IAdapterFinalConfig,
  IAdapterManager,
} from "../utils/adapter/types"

type Primitive = string | number | boolean | bigint | symbol | null | undefined

// redux 5 で `DeepPartial` が export されなくなったので、redux 4 と同じ内容の定義をここに持つ
// （プロパティの型がプリミティブを含まないときだけ、その中も省略可能にする）
export type DeepPartial<T> = {
  [K in keyof T]?: unknown extends T[K]
    ? T[K]
    : T[K] extends Exclude<T[K], Primitive>
      ? DeepPartial<T[K]>
      : T[K]
}

type SystemPath = string
type Identifier = string

export interface IRedirect {
  fromPath: string
  toPath: string
  isPermanent?: boolean
  redirectInBrowser?: boolean
  ignoreCase: boolean
  statusCode?: HttpStatusCode
  // ユーザーは、この createRedirect API に何でも追加できる
  [key: string]: any
}

export enum ProgramStatus {
  BOOTSTRAP_FINISHED = `BOOTSTRAP_FINISHED`,
  BOOTSTRAP_QUERY_RUNNING_FINISHED = `BOOTSTRAP_QUERY_RUNNING_FINISHED`,
}

export type PageMode = `SSG` | `DSG` | `SSR`

export interface IGatsbyPage {
  internalComponentName: string
  path: string
  matchPath: undefined | string
  component: SystemPath
  componentChunkName: string
  isCreatedByStatefulCreatePages: boolean
  context: Record<string, unknown>
  updatedAt: number
  // eslint-disable-next-line @typescript-eslint/naming-convention
  pluginCreator___NODE: Identifier
  pluginCreatorId: Identifier
  componentPath: SystemPath
  ownerNodeId: Identifier
  manifestId?: string
  defer?: boolean
  /**
   * 内部用。`page.mode` を使わないこと。いつでも削除される可能性がある
   * `page.mode` が現在信頼できるのは、エンジンの中と `onPostBuild` フックの中だけである
   * （develop では動的であり、いつでも変わりうる）
   * TODO: 削除する。utils/page-mode:materializePageMode のコメントを参照
   *
   * @internal
   */
  mode: PageMode
  slices: Record<string, string>
}

export interface IGatsbySlice {
  componentPath: string
  componentChunkName: string
  context: Record<string, unknown>
  name: string
  updatedAt: number
}

export interface IGatsbyFunction {
  /** ブラウザーからこの関数にアクセスするためのルート **/
  functionRoute: string
  /** 元の関数への絶対パス **/
  originalAbsoluteFilePath: string
  /** 元の関数への相対パス **/
  originalRelativeFilePath: string
  /** コンパイルされた関数への相対パス（常に .js で終わる） **/
  relativeCompiledFilePath: string
  /** コンパイルされた関数への絶対パス（別のマシンには持ち越せない） **/
  absoluteCompiledFilePath: string
  /** path-to-regexp が作成した matchPath の正規表現。関数が動的な場合にだけ作成される。 **/
  matchPath: string | undefined
  /** この関数のルートを所有するプラグイン **/
  pluginName: string
  /** ルートマニフェストの中での関数の使用箇所との照合に使う、関数の識別子 */
  functionId: string
}

export interface IGraphQLTypegenOptions {
  typesOutputPath: string
  documentSearchPaths: Array<string>
  generateOnBuild: boolean
}

export interface IHeader {
  source: string
  headers: Array<{
    key: string
    value: string
  }>
}

// TODO: IGatsbyConfig のキーはすべて省略可能になっている。reducers/config.ts のようなレデューサーで、config のデフォルトの状態を空のオブジェクトにできるようにするためである。しかし、Joi のバリデーションがデフォルト値を設定するので、一部のオプションは実際には常に定義されており、これは理想的ではない。何とかして直す :D
export interface IGatsbyConfig {
  plugins?: Array<{
    // これは `gatsby-plugin-manifest` のようなプラグインの名前である
    resolve: string
    options: {
      [key: string]: unknown
    }
  }>
  siteMetadata?: {
    title?: string
    author?: string
    description?: string
    siteUrl?: string
    // siteMetadata は自由な形式である
    [key: string]: unknown
  }
  // @deprecated
  polyfill?: boolean
  developMiddleware?: (app: Express) => void
  proxy?: any
  partytownProxiedURLs?: Array<string>
  pathPrefix?: string
  assetPrefix?: string
  mapping?: Record<string, string>
  jsxRuntime?: `classic` | `automatic`
  jsxImportSource?: string
  trailingSlash?: TrailingSlash
  graphqlTypegen?: IGraphQLTypegenOptions
  headers?: Array<IHeader>
  adapter?: IAdapter
}

export interface IGatsbyNode {
  id: Identifier
  parent: Identifier
  children: Array<Identifier>
  internal: {
    type: string
    counter: number
    owner: string
    contentDigest: string
    mediaType?: string
    content?: string
    description?: string
  }
  [key: string]: unknown
  fields: Array<string>
}

export interface IGatsbyPlugin {
  id: Identifier
  name: string
  version: string
  [key: string]: any
}

export interface IGatsbyPluginContext {
  [key: string]: (...args: Array<any>) => any
}

export interface IGatsbyStaticQueryComponents {
  name: string
  componentPath: SystemPath
  id: Identifier
  query: string
  hash: string
}

export interface IGatsbyPageComponent {
  componentPath: SystemPath
  componentChunkName: string
  query: string
  pages: Set<string>
  isInBootstrap: boolean
  serverData: boolean
  config: boolean
  isSlice: boolean
  Head: boolean
}

export interface IDefinitionMeta {
  name: string
  def: DefinitionNode
  filePath: string
  text: string
  templateLoc: SourceLocation
  printedAst: string | null
  isHook: boolean
  isStaticQuery: boolean
  isFragment: boolean
  isConfigQuery: boolean
  hash: number
}

type GatsbyNodes = Map<string, IGatsbyNode>

export interface IGatsbyIncompleteJobV2 {
  job: InternalJob
}

export interface IGatsbyIncompleteJob {
  job: InternalJob
  plugin: IGatsbyPlugin
}

export interface IGatsbyCompleteJobV2 {
  result: JobResultInterface
  inputPaths: InternalJob[`inputPaths`]
}

export interface IPlugin {
  name: string
  options: Record<string, unknown>
}

export interface IBabelStage {
  plugins: Array<IPlugin>
  presets: Array<IPlugin>
  options?: {
    cacheDirectory: boolean
    sourceType: string
    sourceMaps?: string
  }
}

export interface IStateProgram extends IProgram {
  extensions: Array<string>
  browserslist: Array<string>
}

export interface IQueryState {
  dirty: number
  running: number
}

export interface IComponentState {
  componentPath: string
  query: string
  pages: Set<Identifier>
  errors: number
}

export interface IHtmlFileState {
  dirty: number
  isDeleted: boolean
  pageDataHash: string
}

export interface IStaticQueryResultState {
  dirty: number
  staticQueryResultHash: string
}

export type GatsbyNodeAPI =
  | `onPreBootstrap`
  | `onPostBootstrap`
  | `onCreateWebpackConfig`
  | `onCreatePage`
  | `onCreateNode`
  | `sourceNodes`
  | `createPagesStatefully`
  | `createPages`
  | `onPostBuild`

export interface IGatsbyState {
  program: IStateProgram
  nodes: GatsbyNodes
  nodesByType: Map<string, GatsbyNodes>
  resolvedNodesCache: Map<string, any> // TODO
  nodesTouched: Set<string>
  typeOwners: {
    pluginsToTypes: Map<
      IGatsbyPlugin[`name`],
      Set<IGatsbyNode[`internal`][`type`]>
    >
    typesToPlugins: Map<IGatsbyNode[`internal`][`type`], IGatsbyPlugin[`name`]>
  }
  nodeManifests: Array<INodeManifest>
  requestHeaders: Map<string, { [header: string]: string }>
  statefulSourcePlugins: Set<string>
  telemetry: ITelemetry
  lastAction: ActionsUnion
  flattenedPlugins: Array<{
    resolve: SystemPath
    id: Identifier
    name: string
    version: string
    pluginOptions: {
      plugins: []
      [key: string]: unknown
    }
    nodeAPIs: Array<GatsbyNodeAPI>
    browserAPIs: Array<
      | `onRouteUpdate`
      | `registerServiceWorker`
      | `onServiceWorkerActive`
      | `onPostPrefetchPathname`
    >
    ssrAPIs: Array<`onRenderBody` | `onPreRenderHTML`>
    pluginFilepath: SystemPath
    subPluginPaths?: Array<string>
    modulePath?: string
  }>
  config: IGatsbyConfig
  functions: Array<IGatsbyFunction>
  pages: Map<string, IGatsbyPage>
  schema: GraphQLSchema
  definitions: Map<string, IDefinitionMeta>
  status: {
    plugins: Record<string, IGatsbyPlugin>
    PLUGINS_HASH: Identifier
    LAST_NODE_COUNTER: number
    cdnObfuscatedPrefix: string
  }
  queries: {
    byNode: Map<Identifier, Set<Identifier>>
    byConnection: Map<string, Set<Identifier>>
    queryNodes: Map<Identifier, Set<Identifier>>
    trackedQueries: Map<Identifier, IQueryState>
    trackedComponents: Map<string, IComponentState>
    deletedQueries: Set<Identifier>
    dirtyQueriesListToEmitViaWebsocket: Array<string>
  }
  components: Map<IGatsbyPageComponent[`componentPath`], IGatsbyPageComponent>
  staticQueryComponents: Map<
    IGatsbyStaticQueryComponents[`id`],
    IGatsbyStaticQueryComponents
  >
  staticQueriesByTemplate: Map<SystemPath, Array<Identifier>>
  pendingPageDataWrites: {
    pagePaths: Set<string>
    sliceNames: Set<string>
  }
  // @deprecated
  jobs: {
    active: Array<any> // TODO
    done: Array<any> // TODO
  }
  jobsV2: {
    incomplete: Map<Identifier, IGatsbyIncompleteJobV2>
    complete: Map<Identifier, IGatsbyCompleteJobV2>
    jobsByRequest: Map<string, Set<Identifier>>
  }
  webpack: any // TODO これは ./utils/webpack.config.js の出力であるべき
  webpackCompilationHash: string
  redirects: Array<IRedirect>
  babelrc: {
    stages: {
      [key in Stage]: IBabelStage
    }
  }
  schemaCustomization: {
    composer: null | SchemaComposer<any>
    context: Record<string, any>
    fieldExtensions: GraphQLFieldExtensionDefinition
    printConfig: {
      path?: string
      include?: { types?: Array<string>; plugins?: Array<string> }
      exclude?: { types?: Array<string>; plugins?: Array<string> }
      withFieldTypes?: boolean
    } | null
    thirdPartySchemas: Array<GraphQLSchema>
    types: Array<
      string | { typeOrTypeDef: DocumentNode; plugin: IGatsbyPlugin }
    >
  }
  logs: IGatsbyCLIState
  inferenceMetadata: {
    step: string // TODO enum か union にする
    typeMap: {
      [key: string]: ITypeMetadata
    }
  }
  pageDataStats: Map<SystemPath, number>
  visitedPages: Map<string, Set<string>>
  html: {
    trackedHtmlFiles: Map<Identifier, IHtmlFileState>
    browserCompilationHash: string
    ssrCompilationHash: string
    trackedStaticQueryResults: Map<string, IStaticQueryResultState>
    unsafeBuiltinWasUsedInSSR: boolean
    templateCompilationHashes: Record<string, string>
    slicesProps: {
      bySliceId: Map<
        string,
        {
          pages: Set<string>
          props: Record<string, unknown>
          sliceName: string
          hasChildren: boolean
          dirty: number
        }
      >
      byPagePath: Map<string, Set<string>>
      bySliceName: Map<
        string,
        {
          sliceDataHash: string
          dirty: number
          props: Set<string>
        }
      >
    }
    pagesThatNeedToStitchSlices: Set<string>
  }
  slices: Map<string, IGatsbySlice>
  componentsUsingSlices: Map<string, ICollectedSlices>
  slicesByTemplate: Map<SystemPath, ICollectedSlices>
  adapter: {
    instance?: IAdapter
    manager: IAdapterManager
    config: IAdapterFinalConfig
  }
  remoteFileAllowedUrls: Set<string>
}

export type GatsbyStateKeys = keyof IGatsbyState

export interface ICachedReduxState {
  nodes?: IGatsbyState[`nodes`]
  typeOwners?: IGatsbyState[`typeOwners`]
  statefulSourcePlugins?: IGatsbyState[`statefulSourcePlugins`]
  status: IGatsbyState[`status`]
  components: IGatsbyState[`components`]
  jobsV2: IGatsbyState[`jobsV2`]
  staticQueryComponents: IGatsbyState[`staticQueryComponents`]
  webpackCompilationHash: IGatsbyState[`webpackCompilationHash`]
  pageDataStats: IGatsbyState[`pageDataStats`]
  pages?: IGatsbyState[`pages`]
  staticQueriesByTemplate: IGatsbyState[`staticQueriesByTemplate`]
  pendingPageDataWrites: IGatsbyState[`pendingPageDataWrites`]
  queries: IGatsbyState[`queries`]
  html: IGatsbyState[`html`]
  slices: IGatsbyState[`slices`]
  slicesByTemplate: IGatsbyState[`slicesByTemplate`]
}

export type ActionsUnion =
  | IInitAction
  | IAddChildNodeToParentNodeAction
  | IAddFieldToNodeAction
  | IAddThirdPartySchema
  | IApiFinishedAction
  | ICreateFieldExtension
  | ICreateNodeAction
  | ICreatePageAction
  | ICreatePageDependencyAction
  | ICreateTypes
  | IDeleteCacheAction
  | IDeleteNodeAction
  | IDeletePageAction
  | IPageQueryRunAction
  | IPrintTypeDefinitions
  | IQueryClearDirtyQueriesListToEmitViaWebsocket
  | IQueryExtractedAction
  | IQueryExtractedBabelSuccessAction
  | IQueryExtractionBabelErrorAction
  | IQueryExtractionGraphQLErrorAction
  | IQueryStartAction
  | IRemoveStaticQuery
  | IReplaceComponentQueryAction
  | IReplaceStaticQueryAction
  | IReplaceWebpackConfigAction
  | ISetPluginStatusAction
  | ISetProgramStatusAction
  | ISetResolvedNodesAction
  | ISetSchemaAction
  | ISetGraphQLDefinitionsAction
  | ISetSiteFlattenedPluginsAction
  | ISetWebpackCompilationHashAction
  | ISetSSRGlobalSharedWebpackCompilationHashAction
  | ISetWebpackConfigAction
  | ITouchNodeAction
  | IUpdatePluginsHashAction
  | ICreateJobV2Action
  | IEndJobV2Action
  | IRemoveStaleJobV2Action
  | IAddPageDataStatsAction
  | IAddSliceDataStatsAction
  | IRemoveTemplateComponentAction
  | ISetBabelPluginAction
  | ISetBabelPresetAction
  | ISetBabelOptionsAction
  | ICreateJobAction
  | ISetJobAction
  | IEndJobAction
  | ISetStaticQueriesByTemplateAction
  | IAddPendingPageDataWriteAction
  | IAddPendingTemplateDataWriteAction
  | IAddPendingSliceDataWriteAction
  | IAddPendingSliceTemplateDataWriteAction
  | IClearPendingPageDataWriteAction
  | IClearPendingSliceDataWriteAction
  | ICreateResolverContext
  | IClearSchemaCustomizationAction
  | ISetSchemaComposerAction
  | IStartIncrementalInferenceAction
  | IBuildTypeMetadataAction
  | IDisableTypeInferenceAction
  | ISetProgramAction
  | ISetProgramExtensions
  | IRemovedHtml
  | ITrackedHtmlCleanup
  | IGeneratedHtml
  | IMarkHtmlDirty
  | ISSRUsedUnsafeBuiltin
  | ISetSiteConfig
  | IMergeWorkerQueryState
  | ISetComponentFeatures
  | IMaterializePageMode
  | ISetJobV2Context
  | IClearJobV2Context
  | ISetDomainRequestHeaders
  | IEnableStatefulSourcePluginAction
  | ICreateSliceAction
  | IDeleteSliceAction
  | ISetSSRTemplateWebpackCompilationHashAction
  | ISetComponentsUsingSlicesAction
  | ISetSlicesByTemplateAction
  | ISetSlicesProps
  | ISlicesPropsRemoveStale
  | ISlicesPropsRendered
  | ISlicesStitched
  | ISlicesScriptsRegenerated
  | IProcessGatsbyImageSourceUrlAction
  | IClearGatsbyImageSourceUrlAction
  | ISetAdapterAction
  | IDisablePluginsByNameAction
  | IAddImageCdnAllowedUrl

export interface IInitAction {
  type: `INIT`
}

export interface ISetComponentFeatures {
  type: `SET_COMPONENT_FEATURES`
  payload: {
    componentPath: string
    serverData: boolean
    config: boolean
    Head: boolean
  }
}

export interface IApiFinishedAction {
  type: `API_FINISHED`
  payload: {
    apiName: GatsbyNodeAPI
  }
}

interface ISetBabelPluginAction {
  type: `SET_BABEL_PLUGIN`
  payload: {
    stage: Stage
    name: IPlugin[`name`]
    options: IPlugin[`options`]
  }
}

interface ISetBabelPresetAction {
  type: `SET_BABEL_PRESET`
  payload: {
    stage: Stage
    name: IPlugin[`name`]
    options: IPlugin[`options`]
  }
}

interface ISetBabelOptionsAction {
  type: `SET_BABEL_OPTIONS`
  payload: {
    stage: Stage
    name: IPlugin[`name`]
    options: IPlugin[`options`]
  }
}

export interface ICreateJobV2Action {
  type: `CREATE_JOB_V2`
  payload: {
    job: IGatsbyIncompleteJobV2[`job`]
  }
  plugin: { name: string }
}

export interface IEndJobV2Action {
  type: `END_JOB_V2`
  payload: {
    jobContentDigest: string
    result: JobResultInterface
  }
  plugin: { name: string }
}

export interface IRemoveStaleJobV2Action {
  type: `REMOVE_STALE_JOB_V2`
  payload: {
    contentDigest: string
  }
}

export type ICreateJobV2FromInternalAction = ThunkAction<
  Promise<Record<string, unknown>>,
  IGatsbyState,
  void,
  ActionsUnion
>

interface ICreateJobAction {
  type: `CREATE_JOB`
  payload: {
    id: string
    job: IGatsbyIncompleteJob[`job`]
  }
  plugin: IGatsbyIncompleteJob[`plugin`]
}

interface ISetJobAction {
  type: `SET_JOB`
  payload: {
    id: string
    job: IGatsbyIncompleteJob[`job`]
  }
  plugin: IGatsbyIncompleteJob[`plugin`]
}

interface IEndJobAction {
  type: `END_JOB`
  payload: {
    id: string
    job: IGatsbyIncompleteJob[`job`]
  }
  plugin: IGatsbyIncompleteJob[`plugin`]
}

export interface ICreatePageDependencyActionPayloadType {
  path: string
  nodeId?: string
  connection?: string
}

export interface ICreatePageDependencyAction {
  type: `CREATE_COMPONENT_DEPENDENCY`
  plugin?: string
  payload: Array<ICreatePageDependencyActionPayloadType>
}

export interface IDeleteComponentDependenciesAction {
  type: `DELETE_COMPONENTS_DEPENDENCIES`
  payload: {
    paths: Array<string>
  }
}

export interface IReplaceComponentQueryAction {
  type: `REPLACE_COMPONENT_QUERY`
  payload: {
    query: string
    componentPath: string
  }
}

export interface IReplaceStaticQueryAction {
  type: `REPLACE_STATIC_QUERY`
  plugin: IGatsbyPlugin | null | undefined
  payload: {
    name: string
    componentPath: string
    id: string
    query: string
    hash: string
  }
}

export interface IQueryClearDirtyQueriesListToEmitViaWebsocket {
  type: `QUERY_CLEAR_DIRTY_QUERIES_LIST_TO_EMIT_VIA_WEBSOCKET`
}

export interface IQueryExtractedAction {
  type: `QUERY_EXTRACTED`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: { componentPath: string; query: string }
}

export interface IQueryExtractionGraphQLErrorAction {
  type: `QUERY_EXTRACTION_GRAPHQL_ERROR`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: { componentPath: string; error: string }
}

export interface IQueryExtractedBabelSuccessAction {
  type: `QUERY_EXTRACTION_BABEL_SUCCESS`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: { componentPath: string }
}

export interface IQueryExtractionBabelErrorAction {
  type: `QUERY_EXTRACTION_BABEL_ERROR`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: {
    componentPath: string
    error: Error
  }
}

export interface ISetProgramStatusAction {
  type: `SET_PROGRAM_STATUS`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: ProgramStatus
}

export interface IPageQueryRunAction {
  type: `PAGE_QUERY_RUN`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: {
    path: string
    componentPath: string
    queryType: `page` | `static` | `slice`
    resultHash: string
    queryHash: string
  }
}

export interface IQueryStartAction {
  type: `QUERY_START`
  plugin: IGatsbyPlugin
  traceId: string | undefined
  payload: { path: string; componentPath: string; isPage: boolean }
}

export interface IRemoveStaleJobAction {
  type: `REMOVE_STALE_JOB_V2`
  plugin: IGatsbyPlugin | undefined
  traceId?: string
  payload: { contentDigest: string }
}

export interface IAddThirdPartySchema {
  type: `ADD_THIRD_PARTY_SCHEMA`
  plugin: IGatsbyPlugin
  traceId?: string
  payload: GraphQLSchema
}

export interface ICreateTypes {
  type: `CREATE_TYPES`
  plugin: IGatsbyPlugin
  traceId?: string
  payload: DocumentNode | Array<DocumentNode>
}

export interface ICreateFieldExtension {
  type: `CREATE_FIELD_EXTENSION`
  plugin: IGatsbyPlugin
  traceId?: string
  payload: {
    name: string
    extension: GraphQLFieldExtensionDefinition
  }
}

export interface IPrintTypeDefinitions {
  type: `PRINT_SCHEMA_REQUESTED`
  plugin: IGatsbyPlugin
  traceId?: string
  payload: {
    path?: string
    include?: { types?: Array<string>; plugins?: Array<string> }
    exclude?: { types?: Array<string>; plugins?: Array<string> }
    withFieldTypes?: boolean
  }
}

export interface ICreateResolverContext {
  type: `CREATE_RESOLVER_CONTEXT`
  plugin: IGatsbyPlugin
  traceId?: string
  payload:
    | IGatsbyPluginContext
    | { [camelCasedPluginNameWithoutPrefix: string]: IGatsbyPluginContext }
}

interface IClearSchemaCustomizationAction {
  type: `CLEAR_SCHEMA_CUSTOMIZATION`
}

interface ISetSchemaComposerAction {
  type: `SET_SCHEMA_COMPOSER`
  payload: SchemaComposer<any>
}

export interface ICreateServerVisitedPage {
  type: `CREATE_SERVER_VISITED_PAGE`
  payload: IGatsbyPage
  plugin?: IGatsbyPlugin
}

export interface ICreatePageAction {
  type: `CREATE_PAGE`
  payload: IGatsbyPage
  plugin?: IGatsbyPlugin
  contextModified?: boolean
  componentModified?: boolean
  slicesModified?: boolean
}

export interface ICreateSliceAction {
  type: `CREATE_SLICE`
  payload: IGatsbySlice
  plugin?: IGatsbyPlugin
  traceId: string | undefined
  componentModified?: boolean
  contextModified?: boolean
}

export interface IDeleteSliceAction {
  type: `DELETE_SLICE`
  payload: {
    name: string
    componentPath: string
  }
}

export interface ISetComponentsUsingSlicesAction {
  type: `SET_COMPONENTS_USING_PAGE_SLICES`
  payload: Map<string, ICollectedSlices>
}

export interface ISetSlicesByTemplateAction {
  type: `SET_SLICES_BY_TEMPLATE`
  payload: {
    componentPath: string
    slices: ICollectedSlices
  }
}

export interface ISetSlicesProps {
  type: `SET_SLICES_PROPS`
  payload: Record<
    string,
    Record<
      string,
      {
        props: Record<string, unknown>
        sliceName: string
        hasChildren: boolean
      }
    >
  >
}

export interface ISlicesPropsRemoveStale {
  type: `SLICES_PROPS_REMOVE_STALE`
}

export interface ISlicesPropsRendered {
  type: `SLICES_PROPS_RENDERED`
  payload: Array<{ sliceId: string }>
}

export interface ISlicesStitched {
  type: `SLICES_STITCHED`
}

export interface ISlicesScriptsRegenerated {
  type: `SLICES_SCRIPTS_REGENERATED`
}

export interface ICreateRedirectAction {
  type: `CREATE_REDIRECT`
  payload: IRedirect
}

export interface IDeleteCacheAction {
  type: `DELETE_CACHE`
  cacheIsCorrupt?: boolean
}

export interface IRemoveTemplateComponentAction {
  type: `REMOVE_STATIC_QUERIES_BY_TEMPLATE`
  payload: {
    componentPath: string
  }
}

export interface ISetStaticQueriesByTemplateAction {
  type: `SET_STATIC_QUERIES_BY_TEMPLATE`
  payload: {
    componentPath: string
    staticQueryHashes: Array<Identifier>
  }
}

export interface IAddPendingPageDataWriteAction {
  type: `ADD_PENDING_PAGE_DATA_WRITE`
  payload: {
    path: string
  }
}

export interface IAddPendingTemplateDataWriteAction {
  type: `ADD_PENDING_TEMPLATE_DATA_WRITE`
  payload: {
    componentPath: SystemPath
    pages: Array<string>
  }
}

export interface IAddPendingSliceDataWriteAction {
  type: `ADD_PENDING_SLICE_DATA_WRITE`
  payload: {
    name: string
  }
}

export interface IAddPendingSliceTemplateDataWriteAction {
  type: `ADD_PENDING_SLICE_TEMPLATE_DATA_WRITE`
  payload: {
    componentPath: SystemPath
    sliceNames: Array<string>
  }
}

export interface IClearPendingPageDataWriteAction {
  type: `CLEAR_PENDING_PAGE_DATA_WRITE`
  payload: {
    page: string
  }
}

export interface IClearPendingSliceDataWriteAction {
  type: `CLEAR_PENDING_SLICE_DATA_WRITE`
  payload: {
    name: string
  }
}

export interface IDeletePageAction {
  type: `DELETE_PAGE`
  payload: IGatsbyPage
}

export interface IRemoveStaticQuery {
  type: `REMOVE_STATIC_QUERY`
  payload: IGatsbyStaticQueryComponents[`id`]
}

export interface ISetWebpackCompilationHashAction {
  type: `SET_WEBPACK_COMPILATION_HASH`
  payload: IGatsbyState[`webpackCompilationHash`]
}

export interface ISetSSRGlobalSharedWebpackCompilationHashAction {
  type: `SET_SSR_WEBPACK_COMPILATION_HASH`
  payload: string
}

export interface ISetSSRTemplateWebpackCompilationHashAction {
  type: `SET_SSR_TEMPLATE_WEBPACK_COMPILATION_HASH`
  payload: {
    templateHash: string
    templatePath: string
    isSlice: boolean
    pages: Array<string>
  }
}

export interface IUpdatePluginsHashAction {
  type: `UPDATE_PLUGINS_HASH`
  payload: Identifier
}

export interface ISetPluginStatusAction {
  type: `SET_PLUGIN_STATUS`
  plugin: IGatsbyPlugin
  payload: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
}

export interface IReplaceWebpackConfigAction {
  type: `REPLACE_WEBPACK_CONFIG`
  payload: IGatsbyState[`webpack`]
}

export interface ISetWebpackConfigAction {
  type: `SET_WEBPACK_CONFIG`
  payload: Partial<IGatsbyState[`webpack`]>
}

export interface ISetSchemaAction {
  type: `SET_SCHEMA`
  payload: IGatsbyState[`schema`]
}

export interface ISetGraphQLDefinitionsAction {
  type: `SET_GRAPHQL_DEFINITIONS`
  payload: IGatsbyState[`definitions`]
}

export interface ISetSiteConfig {
  type: `SET_SITE_CONFIG`
  payload: IGatsbyState[`config`]
}

export interface ISetSiteFunctions {
  type: `SET_SITE_FUNCTIONS`
  payload: IGatsbyState[`functions`]
}

export interface ICreateNodeAction {
  type: `CREATE_NODE`
  payload: IGatsbyNode
  oldNode?: IGatsbyNode
  traceId: string
  parentSpan: Span
  followsSpan: Span
  plugin: IGatsbyPlugin
}

export interface IAddFieldToNodeAction {
  type: `ADD_FIELD_TO_NODE`
  payload: IGatsbyNode
  addedField: string
}

export interface IAddChildNodeToParentNodeAction {
  type: `ADD_CHILD_NODE_TO_PARENT_NODE`
  payload: IGatsbyNode
}

export interface IDeleteNodeAction {
  type: `DELETE_NODE`
  // FIXME: ここでペイロードが undefined になりうる理由を突き止める
  payload: IGatsbyNode | void
  plugin: IGatsbyPlugin
  isRecursiveChildrenDelete?: boolean
}

export interface ISetSiteFlattenedPluginsAction {
  type: `SET_SITE_FLATTENED_PLUGINS`
  payload: IGatsbyState[`flattenedPlugins`]
}

export interface ISetResolvedNodesAction {
  type: `SET_RESOLVED_NODES`
  payload: {
    key: string
    nodes: IGatsbyState[`resolvedNodesCache`]
  }
}

export interface IAddPageDataStatsAction {
  type: `ADD_PAGE_DATA_STATS`
  payload: {
    pagePath: string
    filePath: SystemPath
    size: number
    pageDataHash: string
  }
}

export interface IAddSliceDataStatsAction {
  type: `ADD_SLICE_DATA_STATS`
  payload: {
    sliceName: string
    filePath: SystemPath
    size: number
    sliceDataHash: string
  }
}

export interface ITouchNodeAction {
  type: `TOUCH_NODE`
  payload: Identifier
  typeName: IGatsbyNode[`internal`][`type`]
  plugin: IGatsbyPlugin
}

interface IStartIncrementalInferenceAction {
  type: `START_INCREMENTAL_INFERENCE`
}

interface IBuildTypeMetadataAction {
  type: `BUILD_TYPE_METADATA`
  payload: {
    nodes: Array<IGatsbyNode>
    clearExistingMetadata: boolean
    typeName: string
  }
}

interface IDisableTypeInferenceAction {
  type: `DISABLE_TYPE_INFERENCE`
  payload: Array<string>
}

interface ISetProgramAction {
  type: `SET_PROGRAM`
  payload: IStateProgram
}

interface ISetProgramExtensions {
  type: `SET_PROGRAM_EXTENSIONS`
  payload: Array<string>
}

interface IRemovedHtml {
  type: `HTML_REMOVED`
  payload: string
}

interface ITrackedHtmlCleanup {
  type: `HTML_TRACKED_PAGES_CLEANUP`
  payload: Set<string>
}

interface IGeneratedHtml {
  type: `HTML_GENERATED`
  payload: Array<string>
}

interface IMarkHtmlDirty {
  type: `HTML_MARK_DIRTY_BECAUSE_STATIC_QUERY_RESULT_CHANGED`
  payload: {
    pages: Set<string>
    slices: Set<string>
    staticQueryHashes: Set<string>
  }
}

interface ISSRUsedUnsafeBuiltin {
  type: `SSR_USED_UNSAFE_BUILTIN`
}

export interface ICreateNodeManifest {
  type: `CREATE_NODE_MANIFEST`
  payload: {
    manifestId: string
    node: IGatsbyNode
    pluginName: string
    updatedAtUTC?: string | number
  }
}

export interface IDeleteNodeManifests {
  type: `DELETE_NODE_MANIFESTS`
}

export interface INodeManifest {
  manifestId: string
  pluginName: string
  node: {
    id: string
  }
}

export interface ISetDomainRequestHeaders {
  type: `SET_REQUEST_HEADERS`
  payload: {
    domain: string
    headers: {
      [header: string]: string
    }
  }
}

export interface IEnableStatefulSourcePluginAction {
  type: `ENABLE_STATEFUL_SOURCE_PLUGIN`
  plugin: IGatsbyPlugin
}

export interface IProcessGatsbyImageSourceUrlAction {
  type: `PROCESS_GATSBY_IMAGE_SOURCE_URL`
  payload: {
    sourceUrl: string
  }
}

export interface IClearGatsbyImageSourceUrlAction {
  type: `CLEAR_GATSBY_IMAGE_SOURCE_URL`
}

export interface ISetAdapterAction {
  type: `SET_ADAPTER`
  payload: {
    instance?: IAdapter
    manager: IAdapterManager
    config: IAdapterFinalConfig
  }
}

export interface IDisablePluginsByNameAction {
  type: `DISABLE_PLUGINS_BY_NAME`
  payload: {
    pluginsToDisable: Array<string>
    reason: string
  }
}

export interface IAddImageCdnAllowedUrl {
  type: `ADD_REMOTE_FILE_ALLOWED_URL`
  payload: {
    urls: Array<string>
  }
  plugin: IGatsbyPlugin
  traceId?: string
}

export interface ITelemetry {
  gatsbyImageSourceUrls: Set<string>
}

export interface IMergeWorkerQueryState {
  type: `MERGE_WORKER_QUERY_STATE`
  payload: {
    workerId: number
    queryStateChunk: IGatsbyState[`queries`]
    queryStateTelemetryChunk: IGatsbyState[`telemetry`]
  }
}

export interface IMaterializePageMode {
  type: `MATERIALIZE_PAGE_MODE`
  payload: {
    path: string
    pageMode: PageMode
  }
}

export interface ISetJobV2Context {
  type: `SET_JOB_V2_CONTEXT`
  payload: {
    job: IGatsbyIncompleteJobV2[`job`]
    requestId: string
  }
}

export interface IClearJobV2Context {
  type: `CLEAR_JOB_V2_CONTEXT`
  payload: {
    requestId: string
  }
}

export const HTTP_STATUS_CODE = {
  /**
   * サーバーがリクエストヘッダーを受け取ったので、クライアントはリクエストボディの送信に進んでよい
   * （ボディを送る必要があるリクエストの場合。たとえば POST リクエスト）。
   * 不適切なヘッダーのためにリクエストが拒否された後で、大きなリクエストボディをサーバーへ送るのは非効率である。
   * サーバーにリクエストヘッダーを確認させるには、クライアントは最初のリクエストでヘッダーとして Expect: 100-continue を送り、
   * ボディを送る前にレスポンスとして 100 Continue のステータスコードを受け取らなければならない。レスポンスの 417 Expectation Failed は、リクエストを続けるべきでないことを示す。
   */
  CONTINUE_100: 100,

  /**
   * リクエストした側がサーバーにプロトコルの切り替えを求め、サーバーがそれに同意した。
   */
  SWITCHING_PROTOCOLS_101: 101,

  /**
   * WebDAV のリクエストは、ファイル操作を伴う多数のサブリクエストを含むことがあり、リクエストの完了に長い時間がかかる。
   * このコードは、サーバーがリクエストを受け取って処理しているが、まだレスポンスを返せないことを示す。
   * これにより、クライアントがタイムアウトして、リクエストが失われたと判断するのを防ぐ。
   */
  PROCESSING_102: 102,

  /**
   * 成功した HTTP リクエストに対する標準のレスポンス。
   * 実際のレスポンスは、使われたリクエストメソッドによって異なる。
   * GET リクエストでは、レスポンスにはリクエストされたリソースに対応するエンティティが含まれる。
   * POST リクエストでは、レスポンスにはアクションの結果を説明する、または含むエンティティが含まれる。
   */
  OK_200: 200,

  /**
   * リクエストが完了し、その結果として新しいリソースが作成された。
   */
  CREATED_201: 201,

  /**
   * リクエストは処理のために受け付けられたが、処理はまだ完了していない。
   * リクエストは最終的に実行されることもされないこともあり、処理の時点で拒否されることもある。
   */
  ACCEPTED_202: 202,

  /**
   * HTTP/1.1 以降
   * サーバーは変換を行うプロキシであり、オリジンから 200 OK を受け取ったが、
   * オリジンのレスポンスを変更したものを返している。
   */
  NON_AUTHORITATIVE_INFORMATION_203: 203,

  /**
   * サーバーはリクエストの処理に成功し、コンテンツを返さない。
   */
  NO_CONTENT_204: 204,

  /**
   * サーバーはリクエストの処理に成功したが、コンテンツを返さない。
   * 204 のレスポンスとは異なり、このレスポンスはリクエストした側がドキュメントビューをリセットすることを求める。
   */
  RESET_CONTENT_205: 205,

  /**
   * クライアントが送った range ヘッダーにより、サーバーはリソースの一部だけを返している（バイトサービング）。
   * range ヘッダーは、HTTP クライアントが、中断されたダウンロードを再開したり、
   * ダウンロードを複数の同時ストリームに分割したりするために使う。
   */
  PARTIAL_CONTENT_206: 206,

  /**
   * 続くメッセージボディは XML メッセージであり、行われたサブリクエストの数に応じて、
   * 複数の別々のレスポンスコードを含むことがある。
   */
  MULTI_STATUS_207: 207,

  /**
   * DAV バインディングのメンバーは、（multistatus）レスポンスの前の部分ですでに列挙されており、
   * 再び含められることはない。
   */
  ALREADY_REPORTED_208: 208,

  /**
   * サーバーはリソースに対するリクエストを完了した。
   * レスポンスは、現在のインスタンスに 1 つ以上の instance-manipulation を適用した結果の表現である。
   */
  IM_USED_226: 226,

  /**
   * リソースに複数の選択肢があり、クライアントが（エージェント駆動のコンテントネゴシエーションで）その中から選べることを示す。
   * たとえばこのコードは、動画の形式の選択肢を複数提示したり、
   * 拡張子の異なるファイルを一覧にしたり、語義の曖昧さ回避の候補を示したりするのに使える。
   */
  MULTIPLE_CHOICES_300: 300,

  /**
   * このリクエストと今後のすべてのリクエストは、指定された URI に向けるべきである。
   */
  MOVED_PERMANENTLY_301: 301,

  /**
   * これは、業界の慣行が標準と食い違っている例である。
   * HTTP/1.0 の仕様（RFC 1945）は、クライアントが一時的なリダイレクトを行うことを求めていた
   * （元の説明の文言は "Moved Temporarily"）。しかし、普及したブラウザーは 302 を
   * 303 See Other の機能として実装した。そのため HTTP/1.1 では、2 つの動作を区別するために
   * ステータスコード 303 と 307 が追加された。それでも、一部の Web アプリケーションやフレームワークは、
   * 302 のステータスコードを 303 であるかのように使っている。
   */
  FOUND_302: 302,

  /**
   * HTTP/1.1 以降
   * リクエストに対するレスポンスは、GET メソッドを使って別の URI から取得できる。
   * POST（または PUT/DELETE）へのレスポンスとして受け取った場合、クライアントは、
   * サーバーがデータを受け取ったと見なし、別の GET メッセージでリダイレクトを行うべきである。
   */
  SEE_OTHER_303: 303,

  /**
   * リクエストヘッダーの If-Modified-Since または If-None-Match で指定されたバージョン以降、リソースが変更されていないことを示す。
   * この場合、クライアントは以前にダウンロードしたコピーをまだ持っているので、リソースを再送する必要はない。
   */
  NOT_MODIFIED_304: 304,

  /**
   * HTTP/1.1 以降
   * リクエストされたリソースはプロキシ経由でしか利用できず、そのアドレスがレスポンスで示される。
   * 多くの HTTP クライアント（Mozilla や Internet Explorer など）は、主にセキュリティ上の理由から、このステータスコードのレスポンスを正しく処理しない。
   */
  USE_PROXY_305: 305,

  /**
   * 現在は使われていない。元々は「以降のリクエストは指定されたプロキシを使うべきである」という意味だった。
   */
  SWITCH_PROXY_306: 306,

  /**
   * HTTP/1.1 以降
   * この場合、リクエストは別の URI でやり直すべきである。ただし、今後のリクエストでは引き続き元の URI を使うべきである。
   * 302 の歴史的な実装とは異なり、元のリクエストを再発行するときにリクエストメソッドを変更することは許されない。
   * たとえば POST リクエストは、別の POST リクエストでやり直すべきである。
   */
  TEMPORARY_REDIRECT_307: 307,

  /**
   * このリクエストと今後のすべてのリクエストは、別の URI でやり直すべきである。
   * 307 と 308 は 302 と 301 の動作に対応するが、HTTP メソッドの変更を許さない。
   * そのため、たとえば恒久的にリダイレクトされたリソースへのフォームの送信が、問題なく続けられる。
   */
  PERMANENT_REDIRECT_308: 308,

  /**
   * 明らかなクライアント側のエラー（リクエストの構文の誤り、大きすぎるサイズ、
   * 無効なリクエストメッセージのフレーミング、不正なリクエストのルーティングなど）のために、サーバーがリクエストを処理できない、または処理しない。
   */
  BAD_REQUEST_400: 400,

  /**
   * 403 Forbidden に似ているが、特に、認証が必要であり、それが失敗したか、まだ提供されていない
   * 場合に使う。レスポンスには、リクエストされたリソースに適用できるチャレンジを含む
   * WWW-Authenticate ヘッダーフィールドを含めなければならない。Basic 認証と Digest 認証を参照。401 は意味の上では
   * 「未認証」、つまりユーザーが必要な資格情報を持っていないことを表す。
   */
  UNAUTHORIZED_401: 401,

  /**
   * 将来の使用のために予約されている。当初は、何らかのデジタルキャッシュやマイクロペイメントの仕組みの
   * 一部としてこのコードを使うことが想定されていたが、そうはならず、このコードは通常は使われない。
   * Google Developers API は、特定の開発者が 1 日あたりのリクエスト数の上限を超えた場合に、このステータスを使う。
   */
  PAYMENT_REQUIRED_402: 402,

  /**
   * リクエストは有効だったが、サーバーが実行を拒否している。
   * ユーザーがリソースに対する必要な権限を持っていない可能性がある。
   */
  FORBIDDEN_403: 403,

  /**
   * リクエストされたリソースは見つからなかったが、将来は利用できるようになるかもしれない。
   * クライアントがその後にリクエストすることは許される。
   */
  NOT_FOUND_404: 404,

  /**
   * リクエストされたリソースが、そのリクエストメソッドに対応していない。
   * たとえば、データを POST で送る必要があるフォームに対する GET リクエストや、読み取り専用のリソースに対する PUT リクエスト。
   */
  METHOD_NOT_ALLOWED_405: 405,

  /**
   * リクエストされたリソースは、リクエストで送られた Accept ヘッダーでは受け入れられないコンテンツしか生成できない。
   */
  NOT_ACCEPTABLE_406: 406,

  /**
   * クライアントは、まずプロキシに対して自分を認証しなければならない。
   */
  PROXY_AUTHENTICATION_REQUIRED_407: 407,

  /**
   * サーバーがリクエストを待っている間にタイムアウトした。
   * HTTP の仕様によると:
   * "The client did not produce a request within the time that the server was prepared to wait. The client MAY repeat the request without modifications at any later time."
   */
  REQUEST_TIMEOUT_408: 408,

  /**
   * 複数の同時更新の間での編集の競合など、リクエストに競合があるために、
   * リクエストを処理できなかったことを示す。
   */
  CONFLICT_409: 409,

  /**
   * リクエストされたリソースがもう利用できず、今後も利用できるようにならないことを示す。
   * リソースが意図的に削除されており、リソースを消去すべき場合に使う。
   * 410 のステータスコードを受け取ったクライアントは、今後そのリソースをリクエストすべきではない。
   * 検索エンジンなどのクライアントは、そのリソースをインデックスから削除すべきである。
   * ほとんどの用途では、クライアントや検索エンジンにリソースを消去させる必要はなく、代わりに "404 Not Found" を使ってよい。
   */
  GONE_410: 410,

  /**
   * リクエストがコンテンツの長さを指定していないが、リクエストされたリソースはそれを必要とする。
   */
  LENGTH_REQUIRED_411: 411,

  /**
   * リクエストした側がリクエストに付けた前提条件の 1 つを、サーバーが満たしていない。
   */
  PRECONDITION_FAILED_412: 412,

  /**
   * リクエストが、サーバーが処理しようとする、または処理できる大きさを超えている。以前は "Request Entity Too Large" と呼ばれていた。
   */
  PAYLOAD_TOO_LARGE_413: 413,

  /**
   * 指定された URI が長すぎて、サーバーが処理できない。多くの場合、GET リクエストのクエリ文字列として大量のデータがエンコードされた結果であり、
   * その場合は POST リクエストに変えるべきである。
   * 以前は "Request-URI Too Long" と呼ばれていた。
   */
  URI_TOO_LONG_414: 414,

  /**
   * リクエストのエンティティが、サーバーまたはリソースが対応していないメディアタイプである。
   * たとえば、クライアントが画像を image/svg+xml としてアップロードしたが、サーバーは画像に別の形式を要求している場合。
   */
  UNSUPPORTED_MEDIA_TYPE_415: 415,

  /**
   * クライアントがファイルの一部を要求した（バイトサービング）が、サーバーはその部分を提供できない。
   * たとえば、クライアントがファイルの終端より先の部分を要求した場合。
   * 以前は "Requested Range Not Satisfiable" と呼ばれていた。
   */
  RANGE_NOT_SATISFIABLE_416: 416,

  /**
   * サーバーが Expect リクエストヘッダーフィールドの要求を満たせない。
   */
  EXPECTATION_FAILED_417: 417,

  /**
   * このコードは、IETF の恒例のエイプリルフールのジョークの 1 つとして、1998 年に RFC 2324（Hyper Text Coffee Pot Control Protocol）で定義されたもので、
   * 実際の HTTP サーバーが実装することは想定されていない。この RFC は、コーヒーを淹れるよう求められた
   * ティーポットがこのコードを返すべきだと定めている。この HTTP ステータスは、Google.com を含む一部のウェブサイトでイースターエッグとして使われている。
   */
  I_AM_A_TEAPOT_418: 418,

  /**
   * レスポンスを生成できないサーバーにリクエストが送られた（たとえば接続の再利用のため）。
   */
  MISDIRECTED_REQUEST_421: 421,

  /**
   * リクエストの形式は正しかったが、意味上のエラーのために従うことができなかった。
   */
  UNPROCESSABLE_ENTITY_422: 422,

  /**
   * アクセスしようとしているリソースはロックされている。
   */
  LOCKED_423: 423,

  /**
   * 前のリクエスト（PROPPATCH など）が失敗したために、このリクエストも失敗した。
   */
  FAILED_DEPENDENCY_424: 424,

  /**
   * クライアントは、Upgrade ヘッダーフィールドで示された TLS/1.0 などの別のプロトコルに切り替えるべきである。
   */
  UPGRADE_REQUIRED_426: 426,

  /**
   * オリジンサーバーは、リクエストが条件付きであることを要求している。
   * 次の問題を防ぐためのものである。"the 'lost update' problem, where a client
   * GETs a resource's state, modifies it, and PUTs it back to the server,
   * when meanwhile a third party has modified the state on the server, leading to a conflict."
   */
  PRECONDITION_REQUIRED_428: 428,

  /**
   * ユーザーが一定の時間内に送ったリクエストが多すぎる。レート制限の仕組みと一緒に使うためのものである。
   */
  TOO_MANY_REQUESTS_429: 429,

  /**
   * 個々のヘッダーフィールド、またはすべてのヘッダーフィールドの合計が大きすぎるため、
   * サーバーがリクエストの処理を拒んでいる。
   */
  REQUEST_HEADER_FIELDS_TOO_LARGE_431: 431,

  /**
   * サーバーの運営者が、あるリソース、またはリクエストされたリソースを含むリソースの集合へのアクセスを拒否するよう、
   * 法的な要求を受けた。451 というコードは、小説 Fahrenheit 451（華氏 451 度）にちなんで選ばれた。
   */
  UNAVAILABLE_FOR_LEGAL_REASONS_451: 451,

  /**
   * 汎用のエラーメッセージ。予期しない状況が起き、より具体的なメッセージが当てはまらない場合に返される。
   */
  INTERNAL_SERVER_ERROR_500: 500,

  /**
   * サーバーがリクエストメソッドを認識しないか、リクエストを完了する能力を持っていない。
   * 通常は、将来利用できるようになることを意味する（たとえば Web サービス API の新機能）。
   */
  NOT_IMPLEMENTED_501: 501,

  /**
   * サーバーがゲートウェイまたはプロキシとして動作しており、上流のサーバーから無効なレスポンスを受け取った。
   */
  BAD_GATEWAY_502: 502,

  /**
   * サーバーは現在利用できない（過負荷、またはメンテナンスで停止しているため）。
   * 一般的には、これは一時的な状態である。
   */
  SERVICE_UNAVAILABLE_503: 503,

  /**
   * サーバーがゲートウェイまたはプロキシとして動作しており、上流のサーバーから時間内にレスポンスを受け取れなかった。
   */
  GATEWAY_TIMEOUT_504: 504,

  /**
   * サーバーが、リクエストで使われた HTTP プロトコルのバージョンに対応していない
   */
  HTTP_VERSION_NOT_SUPPORTED_505: 505,

  /**
   * リクエストに対する透過的なコンテントネゴシエーションが、循環参照になっている。
   */
  VARIANT_ALSO_NEGOTIATES_506: 506,

  /**
   * サーバーが、リクエストの完了に必要な表現を保存できない。
   */
  INSUFFICIENT_STORAGE_507: 507,

  /**
   * サーバーが、リクエストの処理中に無限ループを検出した。
   */
  LOOP_DETECTED_508: 508,

  /**
   * サーバーがリクエストを完了するには、リクエストへのさらなる拡張が必要である。
   */
  NOT_EXTENDED_510: 510,

  /**
   * クライアントは、ネットワークへのアクセスを得るために認証する必要がある。
   * ネットワークへのアクセスを制御するために使われる、通信に割り込むプロキシ（たとえば、Wi-Fi ホットスポットで完全な
   * インターネットアクセスを許可する前に、利用規約への同意を求める「キャプティブポータル」）での使用を意図している。
   */
  NETWORK_AUTHENTICATION_REQUIRED_511: 511,
} as const

export type HttpStatusCode =
  (typeof HTTP_STATUS_CODE)[keyof typeof HTTP_STATUS_CODE]
