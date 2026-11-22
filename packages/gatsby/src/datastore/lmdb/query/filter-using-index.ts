import { GatsbyIterable } from "../../common/iterable"
import {
  DbComparator,
  DbComparatorValue,
  DbQuery,
  dbQueryToDottedField,
  getFilterStatement,
  IDbFilterStatement,
  sortBySpecificity,
} from "../../common/query"
import { IDataStore, ILmdbDatabases, NodeId } from "../../types"
import {
  IIndexMetadata,
  IndexFieldValue,
  IndexKey,
  undefinedSymbol,
} from "./create-index"
import { cartesianProduct, matchesFilter } from "./common"
import { inspect } from "util"

// ordered-binary でエンコードされた JS の値が、0 や 255 のバイトで始まることはない
export const BinaryInfinityNegative = Buffer.from([0])
export const BinaryInfinityPositive = String.fromCharCode(255).repeat(4)

type RangeEdgeAfter = [IndexFieldValue, typeof BinaryInfinityPositive]
type RangeEdgeBefore = [typeof undefinedSymbol, IndexFieldValue]
type RangeValue =
  | IndexFieldValue
  | RangeEdgeAfter
  | RangeEdgeBefore
  | typeof BinaryInfinityPositive
  | typeof BinaryInfinityNegative
type RangeBoundary = Array<RangeValue>

export interface IIndexEntry {
  key: IndexKey
  value: NodeId
}

interface IIndexRange {
  start: RangeBoundary
  end: RangeBoundary
}

enum ValueEdges {
  BEFORE = -1,
  EQ = 0,
  AFTER = 1,
}

export interface IFilterArgs {
  datastore: IDataStore
  databases: ILmdbDatabases
  dbQueries: Array<DbQuery>
  indexMetadata: IIndexMetadata
  limit?: number
  skip?: number
  reverse?: boolean
}

interface IFilterContext extends IFilterArgs {
  usedLimit: number | undefined
  usedSkip: number
  usedQueries: Set<DbQuery>
}

export interface IFilterResult {
  entries: GatsbyIterable<IIndexEntry>
  usedQueries: Set<DbQuery>
  usedLimit: number | undefined
  usedSkip: number
}

interface ILmdbStoreRangeOptions {
  start?: any
  end?: any
  limit?: number | undefined
  offset?: number | undefined
  revers?: boolean
  snapshot?: boolean
}

export function filterUsingIndex(args: IFilterArgs): IFilterResult {
  const context = createFilteringContext(args)
  const ranges = getIndexRanges(context)

  let entries =
    ranges.length > 0
      ? performRangeScan(context, ranges)
      : performFullScan(context)

  if (context.usedQueries.size !== args.dbQueries.length) {
    // インデックスに保存されたデータを使って、結果をさらに絞り込むことを試みる
    entries = narrowResultsIfPossible(context, entries)
  }
  if (isMultiKeyIndex(context) && needsDeduplication(context)) {
    entries = entries.deduplicate(getIdentifier)
  }
  return {
    entries,
    usedQueries: context.usedQueries,
    usedLimit: context.usedLimit,
    usedSkip: context.usedSkip,
  }
}

export function countUsingIndexOnly(args: IFilterArgs): number {
  const context = createFilteringContext(args)
  const {
    databases: { indexes },
    dbQueries,
    indexMetadata: { keyPrefix },
  } = args

  const ranges = getIndexRanges(context)

  if (context.usedQueries.size !== dbQueries.length) {
    throw new Error(`Cannot count using index only`)
  }
  if (isMultiKeyIndex(context) && needsDeduplication(context)) {
    throw new Error(`Cannot count using MultiKey index.`)
  }
  if (ranges.length === 0) {
    const range: ILmdbStoreRangeOptions = {
      start: [keyPrefix],
      end: [getValueEdgeAfter(keyPrefix)],
      snapshot: false,
    }
    return indexes.getKeysCount(range)
  }
  let count = 0
  for (let { start, end } of ranges) {
    start = [keyPrefix, ...start]
    end = [keyPrefix, ...end]
    // 範囲は重なっていないと仮定する
    const range: ILmdbStoreRangeOptions = { start, end, snapshot: false }
    count += indexes.getKeysCount(range)
  }
  return count
}

function createFilteringContext(args: IFilterArgs): IFilterContext {
  return {
    ...args,
    usedLimit: undefined,
    usedSkip: 0,
    usedQueries: new Set<DbQuery>(),
  }
}

function isMultiKeyIndex(context: IFilterContext): boolean {
  return context.indexMetadata.multiKeyFields.length > 0
}

function needsDeduplication(context: IFilterContext): boolean {
  if (!isMultiKeyIndex(context)) {
    return false
  }
  // すべての multiKeyFields に `eq` フィルターが適用されている場合、重複の除去は不要である
  const fieldsWithAppliedEq = new Set<string>()
  context.usedQueries.forEach(q => {
    const filter = getFilterStatement(q)
    if (filter.comparator === DbComparator.EQ) {
      fieldsWithAppliedEq.add(dbQueryToDottedField(q))
    }
  })
  return context.indexMetadata.multiKeyFields.some(
    fieldName => !fieldsWithAppliedEq.has(fieldName)
  )
}

function performRangeScan(
  context: IFilterContext,
  ranges: Array<IIndexRange>
): GatsbyIterable<IIndexEntry> {
  const {
    indexMetadata: { keyPrefix, stats },
    reverse,
  } = context

  let { limit, skip: offset = 0 } = context

  if (context.dbQueries.length !== context.usedQueries.size) {
    // このクエリはインデックスだけでは完全に満たせないので、limit/skip は使えない
    limit = undefined
    offset = 0
  }
  if (ranges.length > 1) {
    // 例: { in: [1, 2] }
    // offset は使えない: 複数の範囲クエリを実行するので、どれに offset を適用するかが明確でない
    // TODO: 範囲がソート済みで重なっていないと仮定すれば、この場合でも offset を使えるはずである
    //   最初の範囲クエリを実行し、遅延的に走査しながら結果を数え、
    //   前のイテレーターが終わったら（件数が分かったら）次の範囲クエリを
    //   offset = offset - previousRangeCount、limit = limit - previousRangeCount で実行すればよい
    limit = typeof limit !== `undefined` ? offset + limit : undefined
    offset = 0
  }
  if (limit && isMultiKeyIndex(context) && needsDeduplication(context)) {
    // limit は使えない:
    // MultiKey インデックスは重複を含むことがあるので、安全な上限を設定することしかできない
    limit *= stats.maxKeysPerItem
  }

  // 範囲がソート済みで重なっていないと仮定すれば、結果を順に yield できる
  const lmdbRanges: Array<ILmdbStoreRangeOptions> = []
  for (let { start, end } of ranges) {
    start = [keyPrefix, ...start]
    end = [keyPrefix, ...end]
    const range = !reverse
      ? { start, end, limit, offset, snapshot: false }
      : { start: end, end: start, limit, offset, reverse, snapshot: false }

    lmdbRanges.push(range)
  }
  context.usedLimit = limit
  context.usedSkip = offset
  return new GatsbyIterable(() => traverseRanges(context, lmdbRanges))
}

function performFullScan(context: IFilterContext): GatsbyIterable<IIndexEntry> {
  // *注意点*: 以前のクエリ実装では、昇順のときに undefined と null の値を
  //   一覧の末尾に置いていた。しかし lmdb-store はそれらを先頭に保持する。
  //   そのため LMDB の場合は、以前の形式に合わせるために 2 つの範囲を連結する必要がある:
  //     concat(undefinedToEnd, topToUndefined)
  const {
    reverse,
    indexMetadata: { keyPrefix },
  } = context

  let start: RangeBoundary = [keyPrefix, getValueEdgeAfter(undefinedSymbol)]
  let end: RangeBoundary = [getValueEdgeAfter(keyPrefix)]
  let range = !reverse
    ? { start, end, snapshot: false }
    : { start: end, end: start, reverse, snapshot: false }

  const undefinedToEnd = range

  // null と undefined の値を連結する
  end = start
  start = [keyPrefix, null]
  range = !reverse
    ? { start, end, snapshot: false }
    : { start: end, end: start, reverse, snapshot: false }

  const topToUndefined = range

  const ranges: Array<ILmdbStoreRangeOptions> = !reverse
    ? [undefinedToEnd, topToUndefined]
    : [topToUndefined, undefinedToEnd]

  return new GatsbyIterable(() => traverseRanges(context, ranges))
}

function* traverseRanges(
  context: IFilterContext,
  ranges: Array<ILmdbStoreRangeOptions>
): Generator<IIndexEntry> {
  const {
    databases: { indexes },
  } = context

  for (const range of ranges) {
    // @ts-ignore
    yield* indexes.getRange(range)
  }
}

/**
 * インデックススキャン後の結果を受け取り、クエリの未使用の部分でさらに絞り込むことを試みる。
 *
 * これは O(N) だが、インデックスにあるデータを使えるという利点がある。
 * そのため、こうしたフィルターでは `getNode()` の呼び出し（およびそれに伴うデシリアライズの複雑さ）を実質的に省ける。
 *
 * 例:
 *   インデックスが { foo: 1, bar: 1 } であるとする
 *
 * ここで次のクエリを実行する:
 *   sort: [`foo`]
 *   filter: { bar: { eq: `test` }}
 *
 * 最初のフィルター処理では、インデックス全体のスキャンが必要になる（`bar` がインデックスの最後のフィールドのため）。
 *
 * しかし、`bar` の値はインデックス自体に保存されているので、
 * ノードの内容全体を読み込まなくても、この値で絞り込める。
 */
function narrowResultsIfPossible(
  context: IFilterContext,
  entries: GatsbyIterable<IIndexEntry>
): GatsbyIterable<IIndexEntry> {
  const { indexMetadata, dbQueries, usedQueries } = context

  const indexFields = new Map<string, number>()
  indexMetadata.keyFields.forEach(([fieldName], positionInKey) => {
    // すべてのインデックスキーは [indexId, field1, field2, ...] であり、`indexMetadata.keyFields` は [field1, field2, ...] を含む
    // `indexId` が最初の列にあるので、正しく参照するにはフィールドを +1 ずらす必要がある
    indexFields.set(fieldName, positionInKey + 1)
  })

  type Filter = [filter: IDbFilterStatement, fieldPositionInIndex: number]
  const filtersToApply: Array<Filter> = []

  for (const query of dbQueries) {
    const fieldName = dbQueryToDottedField(query)
    const positionInKey = indexFields.get(fieldName)

    if (typeof positionInKey === `undefined`) {
      // インデックスにこのフィールドのデータがない
      continue
    }
    if (usedQueries.has(query)) {
      // フィルターはすでに適用されている
      continue
    }
    if (isMultiKeyIndex(context) && isNegatedQuery(query)) {
      // NE/NIN は MultiKey インデックスでは使えない:
      //   MultiKey インデックスは重複を含む。否定のクエリはその一部しか除外しないので、
      //   最終結果に他のものが誤って含まれることがある
      continue
    }
    const filter = getFilterStatement(query)
    filtersToApply.push([filter, positionInKey])
    usedQueries.add(query)
  }

  return filtersToApply.length === 0
    ? entries
    : entries.filter(({ key }) => {
        for (const [filter, fieldPositionInIndex] of filtersToApply) {
          const value =
            key[fieldPositionInIndex] === undefinedSymbol
              ? undefined
              : key[fieldPositionInIndex]

          if (!matchesFilter(filter, value)) {
            // AND の意味論を模倣する
            return false
          }
        }
        return true
      })
}

/**
 * インデックスを使える可能性のあるクエリ句を返す。
 * 返される一覧は、クエリの具体性の順にソートされている
 */
function getSupportedQueries(
  context: IFilterContext,
  dbQueries: Array<DbQuery>
): Array<DbQuery> {
  const isSupported = new Set([
    DbComparator.EQ,
    DbComparator.IN,
    DbComparator.GTE,
    DbComparator.LTE,
    DbComparator.GT,
    DbComparator.LT,
    DbComparator.NIN,
    DbComparator.NE,
  ])
  let supportedQueries = dbQueries.filter(query =>
    isSupported.has(getFilterStatement(query).comparator)
  )
  if (isMultiKeyIndex(context)) {
    // 注:
    // NE と NIN はマルチキーインデックスでは使えない。その理由:
    //   ノード { id: 1, field: [`foo`, `bar`] } があるとする
    //   このとき、フィルター { field: { ne: `foo` } } はこのノードを結果から完全に除外すべきである。
    //   しかし、マルチキーインデックスは `foo` と `bar` の値について別々のエントリーを持つ。
    //   最終的な範囲は "foo" のエントリーを除外するが、"bar" のエントリーは含んだままなので、
    //   このノードが誤って結果に含まれてしまう。
    supportedQueries = supportedQueries.filter(query => !isNegatedQuery(query))
  }
  return sortBySpecificity(supportedQueries)
}

function isEqualityQuery(query: DbQuery): boolean {
  const filter = getFilterStatement(query)
  return (
    filter.comparator === DbComparator.EQ ||
    filter.comparator === DbComparator.IN
  )
}

function isNegatedQuery(query: DbQuery): boolean {
  const filter = getFilterStatement(query)
  return (
    filter.comparator === DbComparator.NE ||
    filter.comparator === DbComparator.NIN
  )
}

export function getIndexRanges(context: IFilterContext): Array<IIndexRange> {
  const {
    dbQueries,
    indexMetadata: { keyFields },
  } = context
  const rangeStarts: Array<RangeBoundary> = []
  const rangeEndings: Array<RangeBoundary> = []
  const supportedQueries = getSupportedQueries(context, dbQueries)

  for (const indexFieldInfo of new Map(keyFields)) {
    const query = getMostSpecificQuery(supportedQueries, indexFieldInfo)
    if (!query) {
      // インデックスのすべてのフィールドではなく、接頭辞を使う
      break
    }
    const result = resolveIndexFieldRanges(context, query, indexFieldInfo)
    rangeStarts.push(result.rangeStarts)
    rangeEndings.push(result.rangeEndings)

    if (!isEqualityQuery(query)) {
      // 複合インデックス { a: 1, b: 1, c: 1 } は、eq 以外の（範囲の）演算子を 1 つしか使えない。例:
      //  使える: { a: { eq: `foo` }, b: { eq: 8 }, c: { gt: 5 } }
      //  使えない: { a: { eq: `foo` }, b: { gt: 5 }, c: { eq: 5 } }
      //  （正確には、範囲スキャンができるのは { a: { eq: `foo` }, b: { gt: 5 } } に対してだけである）
      break
    }
  }
  if (!rangeStarts.length) {
    return []
  }
  // 最後のセグメントだけが範囲全体を囲む。
  // たとえば、インデックス { a: 1, b: 1 } とフィルター { a: { eq: `foo` }, b: { eq: `bar` } } がある場合、
  // 次の範囲を生成すべきである:
  // {
  //   start: [`foo`, `bar`],
  //   end: [`foo`, [`bar`, BinaryInfinityPositive]]
  // }
  //
  // 次のようにはしない:
  // {
  //   start: [`foo`, `bar`],
  //   end: [[`foo`, BinaryInfinityPositive], [`bar`, BinaryInfinityPositive]]
  // }
  for (let i = 0; i < rangeStarts.length - 1; i++) {
    rangeEndings[i] = rangeStarts[i]
  }

  // 例:
  //   rangeStarts: [
  //     [field1Start1, field1Start2],
  //     [field2Start1],
  //   ]
  //   rangeEnds: [
  //     [field1End1, field1End2],
  //     [field2End1],
  //   ]
  // 必要なもの:
  //   rangeStartsProduct: [
  //     [field1Start1, field2Start1],
  //     [field1Start2, field2Start1],
  //   ]
  //   rangeEndingsProduct: [
  //     [field1End1, field2End1],
  //     [field1End2, field2End1],
  //   ]
  const rangeStartsProduct = cartesianProduct(...rangeStarts)
  const rangeEndingsProduct = cartesianProduct(...rangeEndings)

  const ranges: Array<IIndexRange> = []
  for (let i = 0; i < rangeStartsProduct.length; i++) {
    ranges.push({
      start: rangeStartsProduct[i],
      end: rangeEndingsProduct[i],
    })
  }
  // TODO: 範囲をソートして積を取る。また、いずれ次のものが必要になるかもしれない:
  //   https://docs.mongodb.com/manual/core/multikey-index-bounds/
  return ranges
}

function getFieldQueries(
  queries: Array<DbQuery>,
  fieldName: string
): Array<DbQuery> {
  return queries.filter(q => dbQueryToDottedField(q) === fieldName)
}

function getMostSpecificQuery(
  queries: Array<DbQuery>,
  [indexField]: [fieldName: string, sortDirection: number]
): DbQuery | undefined {
  const fieldQueries = getFieldQueries(queries, indexField)
  // クエリが具体性の順にソートされていると仮定すれば、最初のクエリを選ぶのが最善である
  return fieldQueries[0]
}

function resolveIndexFieldRanges(
  context: IFilterContext,
  query: DbQuery,
  [field, sortDirection]: [fieldName: string, sortDirection: number]
): {
  rangeStarts: RangeBoundary
  rangeEndings: RangeBoundary
} {
  // 後でデカルト積を作りやすくするため、Array<[start, end]> とせずに
  //  開始と終了を別々に追跡する
  const rangeStarts: RangeBoundary = []
  const rangeEndings: RangeBoundary = []

  const filter = getFilterStatement(query)

  if (filter.comparator === DbComparator.IN && !Array.isArray(filter.value)) {
    throw new Error("The argument to the `in` predicate should be an array")
  }

  context.usedQueries.add(query)

  switch (filter.comparator) {
    case DbComparator.EQ:
    case DbComparator.IN: {
      const arr = Array.isArray(filter.value)
        ? [...filter.value]
        : [filter.value]

      // インデックスのソート方向で範囲をソートする
      arr.sort((a: any, b: any): number => {
        if (a === b) return 0
        if (sortDirection === 1) return a > b ? 1 : -1
        return a < b ? 1 : -1
      })

      let hasNull = false
      for (const item of new Set(arr)) {
        const value = toIndexFieldValue(item, filter)
        if (value === null) hasNull = true
        rangeStarts.push(value)
        rangeEndings.push(getValueEdgeAfter(value))
      }
      // 特別なケース: { eq: null } や { in: [null, `any`]} は、undefined の値も含めなければならない！
      if (hasNull) {
        rangeStarts.push(undefinedSymbol)
        rangeEndings.push(getValueEdgeAfter(undefinedSymbol))
      }
      break
    }
    case DbComparator.LT:
    case DbComparator.LTE: {
      if (Array.isArray(filter.value))
        throw new Error(`${filter.comparator} value must not be an array`)

      const value = toIndexFieldValue(filter.value, filter)
      const end =
        filter.comparator === DbComparator.LT ? value : getValueEdgeAfter(value)

      // 一致する GTE/GT フィルターを探す
      const start =
        resolveRangeEdge(context, field, DbComparator.GTE) ??
        resolveRangeEdge(context, field, DbComparator.GT, ValueEdges.AFTER)

      // null が明示的に要求されていない限り、null や undefined を結果に含めない
      //
      // インデックスの順序:
      //  BinaryInfinityNegative
      //  null
      //  Symbol(`undef`)
      //  -10
      //  10
      //  `Hello`
      //  [`Hello`]
      //  BinaryInfinityPositive
      const rangeHead =
        value === null
          ? BinaryInfinityNegative
          : getValueEdgeAfter(undefinedSymbol)

      rangeStarts.push(start ?? rangeHead)
      rangeEndings.push(end)
      break
    }
    case DbComparator.GT:
    case DbComparator.GTE: {
      if (Array.isArray(filter.value))
        throw new Error(`${filter.comparator} value must not be an array`)

      const value = toIndexFieldValue(filter.value, filter)
      const start =
        filter.comparator === DbComparator.GTE
          ? value
          : getValueEdgeAfter(value)

      // 一致する LT/LTE を探す
      const end =
        resolveRangeEdge(context, field, DbComparator.LTE, ValueEdges.AFTER) ??
        resolveRangeEdge(context, field, DbComparator.LT)

      const rangeTail =
        value === null ? getValueEdgeAfter(null) : BinaryInfinityPositive

      rangeStarts.push(start)
      rangeEndings.push(end ?? rangeTail)
      break
    }
    case DbComparator.NE:
    case DbComparator.NIN: {
      const arr = Array.isArray(filter.value)
        ? [...filter.value]
        : [filter.value]

      // インデックスのソート方向で範囲をソートする
      arr.sort((a: any, b: any): number => {
        if (a === b) return 0
        if (sortDirection === 1) return a > b ? 1 : -1
        return a < b ? 1 : -1
      })
      const hasNull = arr.some(value => value === null)

      if (hasNull) {
        rangeStarts.push(getValueEdgeAfter(undefinedSymbol))
      } else {
        rangeStarts.push(BinaryInfinityNegative)
      }
      for (const item of new Set(arr)) {
        const value = toIndexFieldValue(item, filter)
        if (value === null) continue // 上の hasNull のケースですでに処理済み
        rangeEndings.push(value)
        rangeStarts.push(getValueEdgeAfter(value))
      }
      rangeEndings.push(BinaryInfinityPositive)
      break
    }
    default:
      throw new Error(`Unsupported predicate: ${filter.comparator}`)
  }
  return { rangeStarts, rangeEndings }
}

function resolveRangeEdge(
  context: IFilterContext,
  indexField: string,
  predicate: DbComparator,
  edge: ValueEdges = ValueEdges.EQ
): IndexFieldValue | RangeEdgeBefore | RangeEdgeAfter | undefined {
  const fieldQueries = getFieldQueries(context.dbQueries, indexField)
  for (const dbQuery of fieldQueries) {
    if (context.usedQueries.has(dbQuery)) {
      continue
    }
    const filterStatement = getFilterStatement(dbQuery)
    if (filterStatement.comparator !== predicate) {
      continue
    }
    context.usedQueries.add(dbQuery)
    const value = filterStatement.value
    if (Array.isArray(value)) {
      throw new Error(`Range filter ${predicate} should not have array value`)
    }
    if (typeof value === `object` && value !== null) {
      throw new Error(
        `Range filter ${predicate} should not have value of type ${typeof value}`
      )
    }
    if (edge === 0) {
      return value
    }
    return edge < 0 ? getValueEdgeBefore(value) : getValueEdgeAfter(value)
  }
  return undefined
}

/**
 * 指定した値の直後の境界を返す。lmdb の範囲クエリに適している。
 *
 * 例:
 * ["foo"] の接頭辞で始まり、次に存在する接頭辞までのすべての項目をインデックスから取得する:
 *
 * ```js
 *   db.getRange({ start: ["foo"], end: [getValueEdgeAfter("foo")] })
 * ```
 *
 * このメソッドは、lmdb-store がキーの永続化に使う ordered-binary 形式に依存しており、
 * キーが複合キーで、配列として表現されていることを前提にしている。
 *
 * 実装の詳細: ordered-binary は `null` を、バイナリ列の中のマルチパートの区切りとして扱う
 */
function getValueEdgeAfter(value: IndexFieldValue): RangeEdgeAfter {
  return [value, BinaryInfinityPositive]
}
function getValueEdgeBefore(value: IndexFieldValue): RangeEdgeBefore {
  return [undefinedSymbol, value]
}

function toIndexFieldValue(
  filterValue: DbComparatorValue,
  filter: IDbFilterStatement
): IndexFieldValue {
  if (typeof filterValue === `object` && filterValue !== null) {
    throw new Error(
      `Bad filter value for predicate ${filter.comparator}: ${inspect(
        filter.value
      )}`
    )
  }
  return filterValue
}

function getIdentifier(entry: IIndexEntry): number | string {
  const id = entry.key[entry.key.length - 1]
  if (typeof id !== `number` && typeof id !== `string`) {
    const out = inspect(id)
    throw new Error(
      `Last element of index key is expected to be numeric or string id, got ${out}`
    )
  }
  return id
}
