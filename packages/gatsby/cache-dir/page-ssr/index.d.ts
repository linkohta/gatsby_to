// IGatsbyPage と SystemPath は、このファイルが自己完結するように redux/types からコピーしてインライン化した
type SystemPath = string
type Identifier = string

interface IGatsbyPage {
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
}

// これもインライン化した
interface IQueryResult {
  errors?: Array<Error>
  data?: any
}

// https://codemix.com/opaque-types-in-javascript/
type Opaque<K, T> = T & { __TYPE__: K }
// 詳細は伏せている。これは不透明な内部の型であり、連携する側が依存すべきではないためである（いつでも変わりうる）
type ISSRData = Opaque<
  "ISSRData",
  {
    serverDataHeaders?: Record<string, string>
    serverDataStatus?: number
  }
>

type PageContext = Record<string, any>

interface IPageData {
  componentChunkName: IGatsbyPage["componentChunkName"]
  matchPath?: IGatsbyPage["matchPath"]
  path: IGatsbyPage["path"]
  staticQueryHashes: Array<string>
}

export interface IPageDataWithQueryResult extends IPageData {
  result: {
    data?: any
    pageContext?: PageContext
  }
}

export function getData(args: {
  pathName: string
  // 相対パスの問題を避けるために graphqlEngine の型は参照せず、渡された引数が必要な API を実装していることだけを確認する
  graphqlEngine: {
    runQuery(query: string, context: Record<string, any>): Promise<IQueryResult>
    findPageByPath(pathName: string): IGatsbyPage | undefined
  }
  req: Partial<{
    query: Record<string, unknown>
    method: string
    url: string
    headers: Record<string, string>
  }>
}): Promise<ISSRData>

export function renderPageData(args: {
  data: ISSRData
}): Promise<IPageDataWithQueryResult>

export function renderHTML(args: {
  data: ISSRData
  pageData?: IPageDataWithQueryResult
}): Promise<string>
