// @flow

const _ = require(`lodash`)
const {
  isAbstractType,
  GraphQLOutputType,
  GraphQLUnionType,
  GraphQLList,
  getNamedType,
  getNullableType,
  isCompositeType,
} = require(`graphql`)
const invariant = require(`tiny-invariant`)
const reporter = require(`gatsby-cli/lib/reporter`)
import { store } from "../redux"
import { getDataStore, getNode, getTypes } from "../datastore"
import { GatsbyIterable, isIterable } from "../datastore/common/iterable"
import { wrapNode, wrapNodes } from "../utils/detect-node-mutations"
import {
  toNodeTypeNames,
  fieldNeedToResolve,
  maybeConvertSortInputObjectToSortPath,
} from "./utils"
import { getMaybeResolvedValue } from "./resolvers"

type TypeOrTypeName = string | GraphQLOutputType

/**
 * 省略可能な、ページの依存の情報。
 *
 * @typedef {Object} PageDependencies
 * @property {string} path 取得したノードのデータに依存するページのパス
 * @property {string} [connectionType] この依存を connection として印を付ける
 */
interface PageDependencies {
  path: string;
  connectionType?: string;
}

interface QueryArguments {
  type: TypeOrTypeName;
  query: { filter: Object, sort?: Object };
  firstOnly?: boolean;
}

export interface NodeModel {
  getNodeById(
    { id: string, type?: TypeOrTypeName },
    pageDependencies?: PageDependencies
  ): any | null;
  getNodesByIds(
    { ids: Array<string>, type?: TypeOrTypeName },
    pageDependencies?: PageDependencies
  ): Array<any>;
  getTypes(): Array<string>;
  trackPageDependencies<nodeOrNodes: Node | Node[]>(
    result: nodeOrNodes,
    pageDependencies?: PageDependencies
  ): nodesOrNodes;
  findRootNodeAncestor(obj: any, predicate: () => boolean): Node | null;
  trackInlineObjectsInRootNode(node: Node, sanitize: boolean): Node;
  getFieldValue(node: Node, fieldPath: string): Promise<any>;
}

class LocalNodeModel {
  constructor({
    schema,
    schemaComposer,
    createPageDependency,
    _rootNodeMap,
    _trackedRootNodes,
  }) {
    this.schema = schema
    this.schemaComposer = schemaComposer
    this.createPageDependencyActionCreator = createPageDependency
    this._rootNodeMap = _rootNodeMap || new WeakMap()
    this._trackedRootNodes = _trackedRootNodes || new WeakSet()
    this._prepareNodesQueues = {}
    this._prepareNodesPromises = {}
    this._preparedNodesCache = new Map()
    this.replaceFiltersCache()
  }

  createPageDependency(createPageDependencyArgs) {
    if (createPageDependencyArgs.connection) {
      const nodeTypeNames = toNodeTypeNames(
        this.schema,
        createPageDependencyArgs.connection
      )
      if (nodeTypeNames) {
        nodeTypeNames.forEach(typeName => {
          this.createPageDependencyActionCreator({
            ...createPageDependencyArgs,
            connection: typeName,
          })
        })
        return
      }
    }

    this.createPageDependencyActionCreator(createPageDependencyArgs)
  }

  /**
   * キャッシュを、渡された値（主にテスト用）または空の新しい Map に
   * 置き換える。
   *
   * @param {undefined | null | FiltersCache} map
   * このキャッシュは、フィルターに基づくノードのバケット（Set）の集合をキャッシュし、実際にクエリされた
   * 型の集合ごとにそれを追跡する。フィルターが `id` を直接対象にする場合は、
   * ノードの Set ではなく 1 つのノードだけをキャッシュする。null の場合は、キャッシュの作成も使用もしない。
   */
  replaceFiltersCache(map = new Map()) {
    this._filtersCache = map // 使い方は redux/nodes.js を参照
  }

  withContext(context) {
    return new ContextualNodeModel(this, context)
  }

  /**
   * ID と、省略可能な型を指定して、ストアからノードを取得する。
   *
   * @param {Object} args
   * @param {string} args.id 取得するノードの ID
   * @param {(string|GraphQLOutputType)} [args.type] ノードの型（省略可能）
   * @param {PageDependencies} [pageDependencies]
   * @returns {(Node|null)}
   * @example
   * // Using only the id
   * getNodeById({ id: `123` })
   * // Using id and type
   * getNodeById({ id: `123`, type: `MyType` })
   * // Providing page dependencies
   * getNodeById({ id: `123` }, { path: `/` })
   */
  getNodeById(args, pageDependencies) {
    const { id, type } = args || {}

    const node = getNodeById(id)

    let result
    if (!node) {
      result = null
    } else if (!type) {
      result = node
    } else {
      const nodeTypeNames = toNodeTypeNames(this.schema, type)
      result = nodeTypeNames.includes(node.internal.type) ? node : null
    }

    if (result) {
      this.trackInlineObjectsInRootNode(node)
    }

    return wrapNode(this.trackPageDependencies(result, pageDependencies))
  }

  /**
   * 複数の ID と、省略可能な型を指定して、ストアからノードを取得する。
   *
   * @param {Object} args
   * @param {string[]} args.ids 取得するノードの ID
   * @param {(string|GraphQLOutputType)} [args.type] ノードの型（省略可能）
   * @param {PageDependencies} [pageDependencies]
   * @returns {Node[]}
   * @example
   * // Using only the id
   * getNodesByIds({ ids: [`123`, `456`] })
   *
   * // Using id and type
   * getNodesByIds({ ids: [`123`, `456`], type: `MyType` })
   *
   * // Providing page dependencies
   * getNodesByIds({ ids: [`123`, `456`] }, { path: `/` })
   */
  getNodesByIds(args, pageDependencies) {
    const { ids, type } = args || {}

    const nodes = Array.isArray(ids)
      ? ids.map(id => getNodeById(id)).filter(Boolean)
      : []

    let result
    if (!nodes.length || !type) {
      result = nodes
    } else {
      const nodeTypeNames = toNodeTypeNames(this.schema, type)
      result = nodes.filter(node => nodeTypeNames.includes(node.internal.type))
    }

    if (result) {
      result.forEach(node => this.trackInlineObjectsInRootNode(node))
    }

    return wrapNodes(this.trackPageDependencies(result, pageDependencies))
  }

  async _query(args) {
    let { query = {}, type, stats, tracer } = args || {}

    // union 型のクエリには（まだ？）対応していない。組み合わされた型どうしに、
    // 共通のフィールドがあるとは限らないためである。
    const gqlType = typeof type === `string` ? this.schema.getType(type) : type
    invariant(
      !(gqlType instanceof GraphQLUnionType),
      `Querying GraphQLUnion types is not supported.`
    )

    const nodeTypeNames = toNodeTypeNames(this.schema, gqlType)

    let runQueryActivity

    // ID でノードを取得できるかを確認し、よりコストの高い
    // クエリのパイプラインをスキップする
    if (
      typeof query?.filter?.id?.eq !== `undefined` &&
      Object.keys(query.filter).length === 1 &&
      Object.keys(query.filter.id).length === 1
    ) {
      if (tracer) {
        runQueryActivity = reporter.phantomActivity(`runQuerySimpleIdEq`, {
          parentSpan: tracer.getParentActivity().span,
        })
        runQueryActivity.start()
      }
      const nodeFoundById = this.getNodeById({
        id: query.filter.id.eq,
        type: gqlType,
      })

      if (runQueryActivity) {
        runQueryActivity.end()
      }

      return {
        gqlType,
        entries: new GatsbyIterable(nodeFoundById ? [nodeFoundById] : []),
        totalCount: async () => (nodeFoundById ? 1 : 0),
      }
    }

    query = maybeConvertSortInputObjectToSortPath(query)

    let materializationActivity
    if (tracer) {
      materializationActivity = reporter.phantomActivity(`Materialization`, {
        parentSpan: tracer.getParentActivity().span,
      })
      materializationActivity.start()
    }
    const fields = getQueryFields({
      filter: query.filter,
      sort: query.sort,
      group: query.group,
      distinct: query.distinct,
      max: query.max,
      min: query.min,
      sum: query.sum,
    })

    const fieldsToResolve = determineResolvableFields(
      this.schemaComposer,
      this.schema,
      gqlType,
      fields
    )

    for (const nodeTypeName of nodeTypeNames) {
      const gqlNodeType = this.schema.getType(nodeTypeName)
      await this.prepareNodes(gqlNodeType, fields, fieldsToResolve)
    }

    if (materializationActivity) {
      materializationActivity.end()
    }

    if (tracer) {
      runQueryActivity = reporter.phantomActivity(`runQuery`, {
        parentSpan: tracer.getParentActivity().span,
      })
      runQueryActivity.start()
    }

    const { entries, totalCount } = await getDataStore().runQuery({
      queryArgs: query,
      gqlSchema: this.schema,
      gqlComposer: this.schemaComposer,
      gqlType,
      resolvedFields: fieldsToResolve,
      nodeTypeNames,
      filtersCache: this._filtersCache,
      stats,
    })

    if (runQueryActivity) {
      runQueryActivity.end()
    }

    return {
      gqlType,
      entries: entries.map(node => {
        // GatsbyIterable では、反復処理に合わせて遅延的に行われる
        this.trackInlineObjectsInRootNode(node)
        return node
      }),
      totalCount,
    }
  }

  /**
   * ストアの中のすべてのノード、または指定した型のすべてのノードを取得する（limit/skip も指定できる）。
   * 結果の一部をイテラブルとして返し、あわせてノードの総数を返す。
   *
   * その `entries` の結果は、リゾルバーからそのまま返すことができる。
   *
   * @param {*} args
   * @param {Object} args.query クエリの引数（例: `limit` と `skip`）
   * @param {(string|GraphQLOutputType)} args.type 型
   * @param {PageDependencies} [pageDependencies]
   * @return {Promise<Object>} `{ entries: GatsbyIterable, totalCount: () => Promise<number> }` を含むオブジェクト
   * @example
   * // Get all nodes of a type
   * const { entries, totalCount } = await findAll({ type: `MyType` })
   *
   * // Get all nodes of a type while filtering and sorting
   * const { entries, totalCount } = await findAll({
   *   type: `MyType`,
   *   query: {
   *     sort: { date: `desc` },
   *     filter: { published: { eq: false } },
   *   },
   * })
   *
   * // The `entries` return value is a `GatsbyIterable` (check its TypeScript definition for more details) and allows you to execute array like methods like filter, map, slice, forEach. Calling these methods is more performant than first turning the iterable into an array and then calling the array methods.
   * const { entries, totalCount } = await findAll({ type: `MyType` })
   *
   * const count = await totalCount()
   * const filteredEntries = entries.filter(entry => entry.published)
   *
   * // However, if a method is not available on the `GatsbyIterable` you can turn it into an array first.
   * const filteredEntries = entries.filter(entry => entry.published)
   * return Array.from(posts).length
   */
  async findAll(args, pageDependencies = {}) {
    const { gqlType, ...result } = await this._query(args, pageDependencies)

    // デフォルトでは connection を追跡する:
    if (typeof pageDependencies.connectionType === `undefined`) {
      pageDependencies.connectionType = gqlType.name
    }
    this.trackPageDependencies(result.entries, pageDependencies)
    return {
      entries: wrapNodes(result.entries),
      totalCount: result.totalCount,
    }
  }

  /**
   * ストアからノードを 1 つ取得する。最初の結果だけを返す。すべてのノードを取得してからフィルターするのではなく、可能な限りこのメソッドを使うこと。その点では `findOne` のほうがパフォーマンスが良い。
   *
   * @param {*} args
   * @param {Object} args.query クエリの引数（例: `filter`）。`sort`、`limit`、`skip` には対応していない。
   * @param {(string|GraphQLOutputType)} args.type 型
   * @param {PageDependencies} [pageDependencies]
   * @returns {Promise<Node>}
   * @example
   * // Get one node of type `MyType` by its title
   * const node = await findOne({
   *   type: `MyType`,
   *   query: { filter: { title: { eq: `My Title` } } },
   * })
   */
  async findOne(args, pageDependencies = {}) {
    const { query = {} } = args
    if (query.sort?.fields?.length > 0) {
      // ソートに対応して、ソートに基づく最初のノードを返すようにする場合は、
      // 個別のノードではなく、常に connection を追跡しなければならなくなる
      throw new Error(
        `nodeModel.findOne() does not support sorting. Use nodeModel.findAll({ query: { limit: 1 } }) instead.`
      )
    }
    const { gqlType, entries } = await this._query({
      ...args,
      query: { ...query, skip: 0, limit: 1, sort: undefined },
    })
    const result = Array.from(entries)
    const first = result[0] ?? null

    if (!first) {
      // 一致するノードが見つからなかった。
      //  これにより、このクエリのデータ追跡が空の状態になる。
      //  つまり、データが更新されても、このクエリを再実行することは決してない
      //  （どこかの時点で、このクエリに一致する新しいノードが追加されたとしても）。
      //  これを回避するには、connection の追跡を追加して、この型のいずれかの
      //  ノードが変わるたびにクエリを再実行するようにしなければならない。
      pageDependencies.connectionType = gqlType.name
    }
    return wrapNode(this.trackPageDependencies(first, pageDependencies))
  }

  prepareNodes(type, queryFields, fieldsToResolve) {
    const typeName = type.name
    if (!this._prepareNodesQueues[typeName]) {
      this._prepareNodesQueues[typeName] = []
    }

    this._prepareNodesQueues[typeName].push({
      queryFields,
      fieldsToResolve,
    })

    if (!this._prepareNodesPromises[typeName]) {
      this._prepareNodesPromises[typeName] = new Promise(resolve => {
        process.nextTick(async () => {
          await this._doResolvePrepareNodesQueue(type)
          resolve()
        })
      })
    }

    return this._prepareNodesPromises[typeName]
  }

  async _doResolvePrepareNodesQueue(type) {
    const typeName = type.name
    const queue = this._prepareNodesQueues[typeName]
    this._prepareNodesQueues[typeName] = []
    this._prepareNodesPromises[typeName] = null

    const { queryFields, fieldsToResolve } = queue.reduce(
      (
        { queryFields, fieldsToResolve },
        { queryFields: nextQueryFields, fieldsToResolve: nextFieldsToResolve }
      ) => {
        return {
          queryFields: _.merge(queryFields, nextQueryFields),
          fieldsToResolve: _.merge(fieldsToResolve, nextFieldsToResolve),
        }
      },
      {
        queryFields: {},
        fieldsToResolve: {},
      }
    )

    const actualFieldsToResolve = deepObjectDifference(
      fieldsToResolve,
      this._preparedNodesCache.get(typeName) || {}
    )

    if (!_.isEmpty(actualFieldsToResolve)) {
      const {
        schemaCustomization: { context: customContext },
      } = store.getState()
      const resolvedNodes = new Map()
      for (const node of getDataStore().iterateNodesByType(typeName)) {
        this.trackInlineObjectsInRootNode(node)
        const resolvedFields = await resolveRecursive(
          this,
          this.schemaComposer,
          this.schema,
          node,
          type,
          queryFields,
          actualFieldsToResolve,
          customContext
        )

        resolvedNodes.set(node.id, resolvedFields)
      }
      if (resolvedNodes.size) {
        await saveResolvedNodes(typeName, resolvedNodes)
      }
      this._preparedNodesCache.set(
        typeName,
        _.merge(
          {},
          this._preparedNodesCache.get(typeName) || {},
          actualFieldsToResolve
        )
      )
    }
  }

  /**
   * ストアの中のすべてのノードの型の名前を取得する。
   *
   * @returns {string[]}
   */
  getTypes() {
    return getTypes()
  }

  /**
   * Node オブジェクトに含まれるインラインのオブジェクトや配列と、
   * その Node オブジェクトの間のリンクを追加する。
   * @param {Node} node ルートの Node
   */
  trackInlineObjectsInRootNode(node) {
    if (!this._trackedRootNodes.has(node)) {
      addRootNodeToInlineObject(
        this._rootNodeMap,
        node,
        node.id,
        true,
        new Set()
      )
      this._trackedRootNodes.add(node)
    }
  }

  /**
   * 渡されたオブジェクトまたは配列を含むノードの、最上位の祖先を探す
   * @param {(Object|Array)} obj Node オブジェクトに属するオブジェクトや配列、または Node オブジェクト
   * @param {nodePredicate} [predicate] 祖先が指定した条件を満たすかを確認するコールバック（省略可能）
   * @returns {Node} predicate を指定しない場合は最上位の祖先。
   * predicate を指定した場合は、predicate の条件を満たす最初のノード
   */
  findRootNodeAncestor(obj, predicate = null) {
    let iterations = 0
    let ids = this._rootNodeMap.get(obj)
    if (!ids) {
      ids = new Set()
    }
    if (obj?.parent && typeof obj.parent === `string`) {
      ids.add(obj.parent)
    }
    let matchingRoot = null

    if (ids) {
      for (const id of ids) {
        let tracked = getNodeById(id)

        if (tracked) {
          const visited = new Set()

          while (iterations++ < 100) {
            if (predicate && predicate(tracked)) {
              return tracked
            }

            if (visited.has(tracked)) {
              reporter.error(
                `It looks like you have a node that's set its parent as itself:\n\n` +
                  tracked
              )
              break
            }
            visited.add(tracked)

            const parent = getNodeById(tracked.parent)

            if (!parent) {
              break
            }

            tracked = parent
          }

          if (tracked && !predicate) {
            matchingRoot = tracked
          }
        }
      }
    }

    return matchingRoot
  }

  /**
   * 1 つのノードまたはノードの配列である結果を受け取り、pageDependencies を
   * 使ってそれらを追跡する。デフォルトでは、現在のリゾルバーのパスに従って
   * 追跡する。結果をそのまま返す。
   *
   * @param {Node | Node[]} result
   * @param {PageDependencies} [pageDependencies]
   * @returns {Node | Node[]}
   */
  trackPageDependencies(result, pageDependencies = {}) {
    const { path, connectionType, track = true } = pageDependencies
    if (path && track) {
      if (connectionType) {
        this.createPageDependency({ path, connection: connectionType })
      } else {
        const nodes = isIterable(result) ? result : [result]
        for (const node of nodes) {
          if (node) {
            this.createPageDependency({ path, nodeId: node.id })
          }
        }
      }
    }

    return result
  }

  /**
   * ノードからフィールドの値を取得するユーティリティ。値を先にマテリアライズする必要がある場合（たとえば @link ディレクティブで接続されたネストしたフィールド）にも使える
   * @param {Node} node
   * @param {string} fieldPath
   * @returns {any}
   * @example
   * // Example: Via schema customization the author ID is linked to the Author type
   * const blogPostNode = {
   *   author: 'author-id-1',
   *   // Rest of node fields...
   * }
   *
   * getFieldValue(blogPostNode, 'author.name')
   */
  getFieldValue = async (node, fieldPath) => {
    const fieldToResolve = pathToObject(fieldPath)
    const typeName = node.internal.type
    const type = this.schema.getType(typeName)

    await this.prepareNodes(type, fieldToResolve, fieldToResolve)

    return getMaybeResolvedValue(node, fieldPath, typeName)
  }
}

class ContextualNodeModel {
  constructor(rootNodeModel, context) {
    this.nodeModel = rootNodeModel
    this.context = context
  }

  withContext(context) {
    return new ContextualNodeModel(this.nodeModel, {
      ...this.context,
      ...context,
    })
  }

  _getFullDependencies(pageDependencies) {
    return {
      path: this.context.path,
      ...(pageDependencies || {}),
    }
  }

  getNodeById(args, pageDependencies) {
    return this.nodeModel.getNodeById(
      args,
      this._getFullDependencies(pageDependencies)
    )
  }

  getNodesByIds(args, pageDependencies) {
    return this.nodeModel.getNodesByIds(
      args,
      this._getFullDependencies(pageDependencies)
    )
  }

  findOne(args, pageDependencies) {
    return this.nodeModel.findOne(
      args,
      this._getFullDependencies(pageDependencies)
    )
  }

  findAll(args, pageDependencies) {
    return this.nodeModel.findAll(
      args,
      this._getFullDependencies(pageDependencies)
    )
  }

  prepareNodes(...args) {
    return this.nodeModel.prepareNodes(...args)
  }

  getTypes(...args) {
    return this.nodeModel.getTypes(...args)
  }

  trackInlineObjectsInRootNode(...args) {
    return this.nodeModel.trackInlineObjectsInRootNode(...args)
  }

  findRootNodeAncestor(...args) {
    return this.nodeModel.findRootNodeAncestor(...args)
  }

  createPageDependency(...args) {
    return this.nodeModel.createPageDependency(...args)
  }

  trackPageDependencies(result, pageDependencies) {
    return this.nodeModel.trackPageDependencies(
      result,
      this._getFullDependencies(pageDependencies)
    )
  }

  getFieldValue = (...args) => this.nodeModel.getFieldValue(...args)
}

const getNodeById = id => (id != null ? getNode(id) : null)

const getQueryFields = ({ filter, sort, group, distinct, max, min, sum }) => {
  const filterFields = filter ? dropQueryOperators(filter) : {}
  const sortFields = (sort && sort.fields) || []

  if (group && !Array.isArray(group)) {
    group = [group]
  } else if (group == null) {
    group = []
  }

  if (distinct && !Array.isArray(distinct)) {
    distinct = [distinct]
  } else if (distinct == null) {
    distinct = []
  }

  if (max && !Array.isArray(max)) {
    max = [max]
  } else if (max == null) {
    max = []
  }

  if (min && !Array.isArray(min)) {
    min = [min]
  } else if (min == null) {
    min = []
  }

  if (sum && !Array.isArray(sum)) {
    sum = [sum]
  } else if (sum == null) {
    sum = []
  }

  return _.merge(
    filterFields,
    ...sortFields.map(pathToObject),
    ...group.map(pathToObject),
    ...distinct.map(pathToObject),
    ...max.map(pathToObject),
    ...min.map(pathToObject),
    ...sum.map(pathToObject)
  )
}

const pathToObject = path => {
  if (path && typeof path === `string`) {
    return path.split(`.`).reduceRight((acc, key) => {
      return { [key]: acc }
    }, true)
  }
  return {}
}

const dropQueryOperators = filter =>
  Object.keys(filter).reduce((acc, key) => {
    const value = filter[key]
    const k = Object.keys(value)[0]
    const v = value[k]
    if (_.isPlainObject(value) && _.isPlainObject(v)) {
      acc[key] =
        k === `elemMatch` ? dropQueryOperators(v) : dropQueryOperators(value)
    } else {
      acc[key] = true
    }
    return acc
  }, {})

const getFields = (schema, type, node) => {
  if (!isAbstractType(type)) {
    return type.getFields()
  }

  const concreteType = type.resolveType(node)
  return schema.getType(concreteType).getFields()
}

async function resolveRecursive(
  nodeModel,
  schemaComposer,
  schema,
  node,
  type,
  queryFields,
  fieldsToResolve,
  customContext
) {
  const gqlFields = getFields(schema, type, node)
  const resolvedFields = {}
  for (const fieldName of Object.keys(fieldsToResolve)) {
    const fieldToResolve = fieldsToResolve[fieldName]
    const queryField = queryFields[fieldName]
    const gqlField = gqlFields[fieldName]
    const gqlNonNullType = getNullableType(gqlField.type)
    const gqlFieldType = getNamedType(gqlField.type)
    let innerValue = await resolveField(
      nodeModel,
      schemaComposer,
      schema,
      node,
      gqlField,
      fieldName,
      customContext
    )
    if (gqlField && innerValue != null) {
      if (
        isCompositeType(gqlFieldType) &&
        !(gqlNonNullType instanceof GraphQLList)
      ) {
        innerValue = await resolveRecursive(
          nodeModel,
          schemaComposer,
          schema,
          innerValue,
          gqlFieldType,
          queryField,
          _.isObject(fieldToResolve) ? fieldToResolve : queryField,
          customContext
        )
      } else if (
        isCompositeType(gqlFieldType) &&
        (_.isArray(innerValue) || innerValue instanceof GatsbyIterable) &&
        gqlNonNullType instanceof GraphQLList
      ) {
        innerValue = await Promise.all(
          innerValue.map(item =>
            item == null
              ? item
              : resolveRecursive(
                  nodeModel,
                  schemaComposer,
                  schema,
                  item,
                  gqlFieldType,
                  queryField,
                  _.isObject(fieldToResolve) ? fieldToResolve : queryField,
                  customContext
                )
          )
        )
      }
    }
    if (innerValue != null) {
      resolvedFields[fieldName] = innerValue
    }
  }

  for (const fieldName of Object.keys(queryFields)) {
    if (!fieldsToResolve[fieldName] && node[fieldName]) {
      // このフィールドが、まだ独自のリゾルバーを持っていることもありうる
      // https://github.com/gatsbyjs/gatsby/issues/27368 を参照
      resolvedFields[fieldName] = await resolveField(
        nodeModel,
        schemaComposer,
        schema,
        node,
        gqlFields[fieldName],
        fieldName,
        customContext
      )
    }
  }

  return _.pickBy(resolvedFields, (value, key) => queryFields[key])
}
let withResolverContext
function resolveField(
  nodeModel,
  schemaComposer,
  schema,
  node,
  gqlField,
  fieldName,
  customContext
) {
  if (!gqlField?.resolve) {
    return node[fieldName]
  }

  // context からこのファイルへ戻る循環依存があるので、これはインラインで require している。
  // https://github.com/gatsbyjs/gatsby/blob/9d33b107d167e3e9e2aa282924a0c409f6afd5a0/packages/gatsby/src/schema/context.ts#L5
  if (!withResolverContext) {
    withResolverContext = require(`./context`)
  }

  return gqlField.resolve(
    node,
    gqlField.args.reduce((acc, arg) => {
      acc[arg.name] = arg.defaultValue
      return acc
    }, {}),
    withResolverContext({
      schema,
      schemaComposer,
      nodeModel,
      customContext,
    }),
    {
      fieldName,
      schema,
      returnType: gqlField.type,
    }
  )
}

const determineResolvableFields = (
  schemaComposer,
  schema,
  type,
  fields,
  isNestedAndParentNeedsResolve = false
) => {
  const fieldsToResolve = {}
  const gqlFields = type.getFields()
  Object.keys(fields).forEach(fieldName => {
    const field = fields[fieldName]
    const gqlField = gqlFields[fieldName]
    const gqlFieldType = getNamedType(gqlField.type)
    const typeComposer = schemaComposer.getAnyTC(type.name)

    const needsResolve = fieldNeedToResolve({
      schema,
      gqlType: type,
      typeComposer,
      schemaComposer,
      fieldName,
    })

    if (_.isObject(field) && gqlField) {
      const innerResolved = determineResolvableFields(
        schemaComposer,
        schema,
        gqlFieldType,
        field,
        isNestedAndParentNeedsResolve || needsResolve
      )
      if (!_.isEmpty(innerResolved)) {
        fieldsToResolve[fieldName] = innerResolved
      }
    }

    if (!fieldsToResolve[fieldName] && needsResolve) {
      fieldsToResolve[fieldName] = true
    }
    if (!fieldsToResolve[fieldName] && isNestedAndParentNeedsResolve) {
      // 親のフィールドを解決する必要がある場合は、ネストしたすべてのフィールドも追加すべきである
      // https://github.com/gatsbyjs/gatsby/issues/26056 を参照
      fieldsToResolve[fieldName] = true
    }
  })
  return fieldsToResolve
}

const addRootNodeToInlineObject = (
  rootNodeMap,
  data,
  nodeId,
  isNode: boolean,
  path: Set<mixed>
): void => {
  const isPlainObject = _.isPlainObject(data)

  if (isPlainObject || _.isArray(data)) {
    if (path.has(data)) return
    path.add(data)

    _.each(data, (o, key) => {
      if (!isNode || key !== `internal`) {
        addRootNodeToInlineObject(rootNodeMap, o, nodeId, false, path)
      }
    })

    // ノード自体を追跡する必要はない
    if (!isNode) {
      let nodeIds = rootNodeMap.get(data)
      if (!nodeIds) {
        nodeIds = new Set([nodeId])
      } else {
        nodeIds.add(nodeId)
      }
      rootNodeMap.set(data, nodeIds)
    }
  }
}

const saveResolvedNodes = (typeName, resolvedNodes) => {
  store.dispatch({
    type: `SET_RESOLVED_NODES`,
    payload: {
      key: typeName,
      nodes: resolvedNodes,
    },
  })
}

const deepObjectDifference = (from, to) => {
  const result = {}
  Object.keys(from).forEach(key => {
    const toValue = to[key]
    if (toValue) {
      if (_.isPlainObject(toValue)) {
        const deepResult = deepObjectDifference(from[key], toValue)
        if (!_.isEmpty(deepResult)) {
          result[key] = deepResult
        }
      }
    } else {
      result[key] = from[key]
    }
  })
  return result
}

module.exports = {
  LocalNodeModel,
}
