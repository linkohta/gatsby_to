import _ from "lodash"
import {
  DbQuery,
  IDbQueryQuery,
  IDbQueryElemMatch,
  IInputQuery,
  FilterValueNullable,
  createDbQueriesFromObject,
  prefixResolvedFields,
  prepareQueryArgs,
} from "../common/query"
import {
  FilterOp,
  FilterCacheKey,
  FiltersCache,
  ensureEmptyFilterCache,
  ensureIndexByQuery,
  ensureIndexByElemMatch,
  getNodesFromCacheByValue,
  intersectNodesByCounter,
  IFilterCache,
  IGatsbyNodePartial,
  getSortFieldIdentifierKeys,
  getGatsbyNodePartial,
} from "./indexing"
import { IGraphQLRunnerStats } from "../../query/types"
import { IRunQueryArgs, IQueryResult } from "../types"
import { GatsbyIterable } from "../common/iterable"
import { getNode } from "../"

export interface IRunFilterArg extends IRunQueryArgs {
  filtersCache: FiltersCache
}

type ISortParameters =
  | {
      fields: Array<string>
      order: Array<boolean | "asc" | "desc" | "ASC" | "DESC">
    }
  | undefined

/**
 * FiltersCache 内の 1 つの filterCache に対応するキーを作成する
 */
function createFilterCacheKey(
  typeNames: Array<string>,
  filter: DbQuery | null
): FilterCacheKey {
  // 注: `elemMatch` は特別なケースだが、キーの中では単に `elemMatch` である
  // （この関数は将来の elemMatch 対応を見越しているが、まだ受け取ることはない）
  let filterStep = filter
  let comparator = ``
  const paths: Array<string> = []
  while (filterStep) {
    paths.push(...filterStep.path)
    if (filterStep.type === `elemMatch`) {
      const q: IDbQueryElemMatch = filterStep
      filterStep = q.nestedQuery
      // `a.elemMatch.b.eq` と `a.b.eq` のフィルターを区別する
      // 実際に問題になる可能性は低いが、ありうる
      paths.push(`elemMatch`)
    } else {
      const q: IDbQueryQuery = filterStep
      comparator = q.query.comparator
      break
    }
  }

  // 注: 区切り文字（`,` と `/`）は任意だが、互いに異なっていなければならない
  return typeNames.join(`,`) + `/` + paths.join(`,`) + `/` + comparator
}

/**
 * フィルターの集合のパスを受け取り、フィルターを通過するノードの集合を
 * 返す。
 * 指定したノードの型のノードだけを対象にする
 * 高速なインデックスがまだなければ作成するので、初回の呼び出しは遅くなる。
 *
 * 注: 公開 API ではない。テストのために export している。
 */
export function applyFastFilters(
  filters: Array<DbQuery>,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  sortFields: Array<string>,
  resolvedFields: any
): Array<IGatsbyNodePartial> | null {
  if (!filtersCache) {
    // フィルターキャッシュが渡されなかった場合は、明示的に使わない
    return null
  }

  const nodesPerValueArrs = getBucketsForFilters(
    filters,
    nodeTypeNames,
    filtersCache,
    sortFields,
    resolvedFields
  )

  if (!nodesPerValueArrs) {
    return null
  }

  if (nodesPerValueArrs.length === 0) {
    return []
  } else {
    // 最小のものを最後に置く（後で pop する）
    nodesPerValueArrs.sort((a, b) => b.length - a.length)

    // nodesPerValueArrs のすべての要素は、counter の順にソートされ、重複がないはずである
    // そのため、この一覧にバケットが 1 つしかない場合、次のループはスキップされる

    while (nodesPerValueArrs.length > 1) {
      // TS の制約: .pop() に対して型ガードができないので、二重にキャストする必要がある
      const a = nodesPerValueArrs.pop() as unknown as Array<IGatsbyNodePartial>
      const b = nodesPerValueArrs.pop() as unknown as Array<IGatsbyNodePartial>
      nodesPerValueArrs.push(intersectNodesByCounter(a, b))
    }

    const result = nodesPerValueArrs[0]

    if (result.length === 0) {
      // 積集合が空になった。すべてのバケットに現れるノードは 1 つもなかった。
      return null
    }

    return result
  }
}

/**
 * これが undefined を返す場合、少なくとも 1 つのキャッシュが見つからなかったことを意味する
 */
function getBucketsForFilters(
  filters: Array<DbQuery>,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  sortFields: Array<string>,
  resolvedFields: any
): Array<Array<IGatsbyNodePartial>> | undefined {
  const nodesPerValueArrs: Array<Array<IGatsbyNodePartial>> = []

  // 各パスの値のキャッシュを作成して取得する過程で、失敗したらすぐに打ち切る
  const every = filters.every(filter => {
    const filterCacheKey = createFilterCacheKey(nodeTypeNames, filter)
    if (filter.type === `query`) {
      // （新しいクエリの種類が追加されたら TS に警告させる）
      const q: IDbQueryQuery = filter
      return getBucketsForQueryFilter(
        filterCacheKey,
        q,
        nodeTypeNames,
        filtersCache,
        nodesPerValueArrs,
        sortFields,
        resolvedFields
      )
    } else {
      // （新しいクエリの種類が追加されたら TS に警告させる）
      const q: IDbQueryElemMatch = filter
      return collectBucketForElemMatch(
        filterCacheKey,
        q,
        nodeTypeNames,
        filtersCache,
        nodesPerValueArrs,
        sortFields,
        resolvedFields
      )
    }
  })

  if (every) {
    return nodesPerValueArrs
  }

  // 「少なくとも 1 つ失敗した」
  return undefined
}

/**
 * 指定したクエリフィルターのバケットをすべて取得する。つまり elemMatch ではない。
 * 1 つも見つからなければ `false` を返す。
 */
function getBucketsForQueryFilter(
  filterCacheKey: FilterCacheKey,
  filter: IDbQueryQuery,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  nodesPerValueArrs: Array<Array<IGatsbyNodePartial>>,
  sortFields: Array<string>,
  resolvedFields: any
): boolean {
  const {
    path: filterPath,
    query: { comparator, value: filterValue },
  } = filter

  if (!filtersCache.has(filterCacheKey)) {
    // indexFields = sortFields
    ensureIndexByQuery(
      comparator as FilterOp,
      filterCacheKey,
      filterPath,
      nodeTypeNames,
      filtersCache,
      sortFields,
      resolvedFields
    )
  }

  const nodesPerValue = getNodesFromCacheByValue(
    filterCacheKey,
    filterValue as FilterValueNullable,
    filtersCache,
    false
  )

  if (!nodesPerValue) {
    return false
  }

  // それ以外の場合はすべて、空でない配列でなければならない。インデックスの
  // 仕組みは、対応する IGatsbyNode がない限り配列を作成しないためである
  nodesPerValueArrs.push(nodesPerValue)

  return true
}

/**
 * 一致したノードの配列は、渡された配列へ参照で入れられる
 */
function collectBucketForElemMatch(
  filterCacheKey: FilterCacheKey,
  filter: IDbQueryElemMatch,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  nodesPerValueArrs: Array<Array<IGatsbyNodePartial>>,
  sortFields: Array<string>,
  resolvedFields: any
): boolean {
  // この elemMatch の比較演算子と対象の値を取得する
  let comparator: FilterOp = `$eq` // （必ず上書きされるが、TS が初期化を要求する）
  let targetValue: FilterValueNullable = null
  let f: DbQuery = filter
  while (f) {
    if (f.type === `elemMatch`) {
      const q: IDbQueryElemMatch = f
      f = q.nestedQuery
    } else {
      const q: IDbQueryQuery = f
      comparator = q.query.comparator as FilterOp
      targetValue = q.query.value as FilterValueNullable
      break
    }
  }
  if (!filtersCache.has(filterCacheKey)) {
    ensureIndexByElemMatch(
      comparator,
      filterCacheKey,
      filter,
      nodeTypeNames,
      filtersCache,
      sortFields,
      resolvedFields
    )
  }

  const nodesByValue = getNodesFromCacheByValue(
    filterCacheKey,
    targetValue,
    filtersCache,
    true
  )

  if (!nodesByValue) {
    return false
  }

  // それ以外の場合はすべて、空でない配列でなければならない。インデックスの
  // 仕組みは、対応する IGatsbyNode がない限り配列を作成しないためである
  nodesPerValueArrs.push(nodesByValue)

  return true
}

/**
 * mongodb に似た構文を使って、ノードの一覧をフィルターしてソートする。
 *
 * @param args 生の graphql クエリの filter/sort を表すオブジェクト
 * @property {{filter?: Object, sort?: Object, skip?: number, limit?: number} | undefined} args.queryArgs
 * @property {FiltersCache} args.filtersCache インデックスのキャッシュ。FilterCacheKey で
 *   グループ化されたノードを検索できる。検索結果は Map で、フィルターが
 *   クエリしようとしている値に対応するノードの配列を保持する。
 *   このオブジェクトは query/query-runner.js にあり、runQuery へ渡される。
 * @returns 結果のコレクション。コレクションは `skip` と `limit` でスライスされる
 */
export function runFastFiltersAndSort(args: IRunFilterArg): IQueryResult {
  const {
    queryArgs: { filter, sort, limit, skip = 0 } = {},
    resolvedFields = {},
    nodeTypeNames,
    filtersCache,
    stats,
  } = args

  const result = convertAndApplyFastFilters(
    filter,
    nodeTypeNames,
    filtersCache,
    resolvedFields,
    stats,
    sort
  )

  const sortedResult = sortNodes(result, sort, resolvedFields, stats)
  const totalCount = async (): Promise<number> => sortedResult.length

  const entries =
    skip || limit
      ? sortedResult.slice(skip, limit ? skip + (limit ?? 0) : undefined)
      : sortedResult

  const nodeObjects = entries.map(nodeIds => getNode(nodeIds.id)!)
  return { entries: new GatsbyIterable(nodeObjects), totalCount }
}

/**
 * 結果のコレクションを返す。
 */
function convertAndApplyFastFilters(
  filterFields: IInputQuery | undefined,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  resolvedFields: Record<string, any>,
  stats: IGraphQLRunnerStats,
  sort: ISortParameters
): Array<IGatsbyNodePartial> {
  const filters = filterFields
    ? prefixResolvedFields(
        createDbQueriesFromObject(prepareQueryArgs(filterFields)),
        resolvedFields
      )
    : []

  if (stats) {
    filters.forEach(filter => {
      const filterStats = filterToStats(filter)
      const comparatorPath = filterStats.comparatorPath.join(`.`)
      stats.comparatorsUsed.set(
        comparatorPath,
        (stats.comparatorsUsed.get(comparatorPath) || 0) + 1
      )
      stats.uniqueFilterPaths.add(filterStats.filterPath.join(`.`))
    })
    if (filters.length > 1) {
      stats.totalNonSingleFilters++
    }
  }

  if (filters.length === 0) {
    const filterCacheKey = createFilterCacheKey(nodeTypeNames, null)
    if (!filtersCache.has(filterCacheKey)) {
      ensureEmptyFilterCache(
        filterCacheKey,
        nodeTypeNames,
        filtersCache,
        sort?.fields || [],
        resolvedFields
      )
    }

    // フィルターがある場合、このキャッシュキーに対するエントリーが（この時点で）存在しなければならない
    const filterCache = filtersCache.get(filterCacheKey) as IFilterCache
    // フィルターがない場合は、ensureCache のステップがこれを埋める:
    const cache = filterCache.meta.orderedByCounter as Array<IGatsbyNodePartial>

    return cache.slice(0)
  }

  const result = applyFastFilters(
    filters,
    nodeTypeNames,
    filtersCache,
    sort?.fields || [],
    resolvedFields
  )

  if (result) {
    if (stats) {
      stats.totalIndexHits++
    }
    return result
  }

  if (stats) {
    // 「結果が空」を意味する
    stats.totalSiftHits++
  }

  return []
}

function filterToStats(
  filter: DbQuery,
  filterPath: Array<string> = [],
  comparatorPath: Array<string> = []
): {
  filterPath: Array<string>
  comparatorPath: Array<string>
} {
  if (filter.type === `elemMatch`) {
    return filterToStats(
      filter.nestedQuery,
      filterPath.concat(filter.path),
      comparatorPath.concat([`elemMatch`])
    )
  } else {
    return {
      filterPath: filterPath.concat(filter.path),
      comparatorPath: comparatorPath.concat(filter.query.comparator),
    }
  }
}

/**
 * フィルター済みのノードの一覧とソートのパラメーターを受け取り、ノードをソートする
 * 入力と同じ参照を返す。その場でソートする
 */
function sortNodes(
  nodes: Array<IGatsbyNodePartial>,
  sort: ISortParameters,
  resolvedFields: any,
  stats: IGraphQLRunnerStats
): Array<IGatsbyNodePartial> {
  if (!sort || sort.fields?.length === 0 || !nodes || nodes.length === 0) {
    return nodes
  }

  // 比較に使う項目を返す関数を作成する
  const sortFields = getSortFieldIdentifierKeys(sort.fields, resolvedFields)
  const sortFns = sortFields.map(
    field =>
      (v): ((any) => any) =>
        field in v
          ? v[field]
          : getGatsbyNodePartial(v, sort.fields, resolvedFields)[field]
  )
  const sortOrder = sort.order.map(order =>
    typeof order === `boolean` ? order : order.toLowerCase()
  ) as Array<boolean | "asc" | "desc">

  if (stats) {
    sortFields.forEach(sortField => {
      stats.uniqueSorts.add(sortField)
    })
  }

  return _.orderBy(nodes, sortFns, sortOrder)
}
