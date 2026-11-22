// IGatsbyPage と SystemPath は、このファイルが自己完結するように redux/types からコピーしてインライン化した
type SystemPath = string
type Identifier = string

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
}

// これもインライン化した
export interface IQueryResult {
  errors?: Array<Error>
  data?: any
}

export class GraphQLEngine {
  constructor({ dbPath }: { dbPath: string })
  runQuery(query: string, context: Record<string, any>): Promise<IQueryResult>
  findPageByPath(pathName: string): IGatsbyPage | undefined
}
