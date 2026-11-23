import { IRunQueryArgs } from "../../types"
import {
  createDbQueriesFromObject,
  DbComparator,
  DbQuery,
  dbQueryToDottedField,
  getFilterStatement,
  prepareQueryArgs,
  sortBySpecificity,
} from "../../common/query"
import { isDesc } from "./common"

interface ISelectIndexArgs {
  filter: IRunQueryArgs["queryArgs"]["filter"]
  sort: IRunQueryArgs["queryArgs"]["sort"]
  maxFields?: number
}

type IndexField = [fieldName: string, orderDirection: number]
type IndexFields = Array<IndexField>

/**
 * このフィルターとソートの組み合わせに対して、インデックスのフィールドを提案する。
 *
 * 両方にインデックスを使えない場合は、フィルターのフィールドよりもソートのフィールドを優先する。
 * ソートは CPU とメモリの両面でコストが高いためである。
 */
export function suggestIndex({
  filter,
  sort,
  maxFields = 6,
}: ISelectIndexArgs): Array<IndexField> {
  const filterQueries = createDbQueriesFromObject(prepareQueryArgs(filter))
  const filterQueriesThatCanUseIndex = getQueriesThatCanUseIndex(filterQueries)
  const sortFields: Array<IndexField> = getSortFieldsThatCanUseIndex(sort)

  if (!sortFields.length && !filterQueriesThatCanUseIndex.length) {
    return []
  }
  if (!filterQueriesThatCanUseIndex.length) {
    return dedupeAndTrim(sortFields, maxFields)
  }
  if (!sortFields.length) {
    return dedupeAndTrim(toIndexFields(filterQueriesThatCanUseIndex), maxFields)
  }

  // フィルターとソートの複合インデックスは、接頭辞のすべてのフィールドが `eq` 述語を持つ場合にだけ意味がある
  // https://docs.mongodb.com/manual/tutorial/sort-results-with-indexes/#sort-and-non-prefix-subset-of-an-index と同じである
  const sortDirection = sortFields[0][1]
  const eqFilterQueries = getEqQueries(filterQueriesThatCanUseIndex)
  const eqFilterFields = toIndexFields(eqFilterQueries, sortDirection)

  // インデックスの接頭辞は、ソートフィールドと重なる eq フィルターを含むべきではない
  const overlap = findOverlappingFields(eqFilterQueries, sortFields)

  return dedupeAndTrim(
    [
      ...eqFilterFields.filter(([name]) => !overlap.has(name)),
      ...sortFields,
      // それでも、他のフィルターフィールドをインデックスの末尾に追加する。インデックスに保存されたデータを使った
      //  結果の追加の絞り込み（ノードオブジェクト全体を読み込まずに行う）を活用するためである
      //  注: eqFilterFields と sortFields にすでに列挙されているフィールドは、dedupeAndTrim で取り除かれる
      ...toIndexFields(filterQueriesThatCanUseIndex, sortDirection),
    ],
    maxFields
  )
}

const canUseIndex = new Set([
  DbComparator.EQ,
  DbComparator.IN,
  DbComparator.GTE,
  DbComparator.LTE,
  DbComparator.GT,
  DbComparator.LT,
  DbComparator.NIN,
  DbComparator.NE,
])

/**
 * インデックスを使える可能性のあるクエリを返す。
 * 返される一覧は、クエリの具体性の順にソートされている
 */
function getQueriesThatCanUseIndex(all: Array<DbQuery>): Array<DbQuery> {
  return sortBySpecificity(
    all.filter(q => canUseIndex.has(getFilterStatement(q).comparator))
  )
}

function getSortFieldsThatCanUseIndex(
  querySortArg: IRunQueryArgs["queryArgs"]["sort"]
): Array<IndexField> {
  const sort = querySortArg || { fields: [], order: [] }
  const initialOrder = isDesc(sort?.order[0]) ? -1 : 1

  const sortFields: Array<IndexField> = []
  for (let i = 0; i < sort.fields.length; i++) {
    const field = sort.fields[i]
    const order = isDesc(sort.order[i]) ? -1 : 1
    if (order !== initialOrder) {
      // 昇順と降順が混在するソートには、インデックスがまだ対応していない :/
      // https://github.com/DoctorEvidence/lmdb-store/discussions/62#discussioncomment-898949 を参照
      break
    }
    sortFields.push([field, order])
  }
  return sortFields
}

function findOverlappingFields(
  filterQueries: Array<DbQuery>,
  sortFields: Array<IndexField>
): Set<string> {
  const overlap = new Set<string>()

  for (const [fieldName] of sortFields) {
    const filterQuery = filterQueries.find(
      q => dbQueryToDottedField(q) === fieldName
    )
    if (!filterQuery) {
      break
    }
    overlap.add(fieldName)
  }
  return overlap
}

function getEqQueries(filterQueries: Array<DbQuery>): Array<DbQuery> {
  return filterQueries.filter(
    filterQuery =>
      getFilterStatement(filterQuery).comparator === DbComparator.EQ
  )
}

function toIndexFields(
  queries: Array<DbQuery>,
  sortDirection: number = 1
): IndexFields {
  return queries.map((q): IndexField => [
    dbQueryToDottedField(q),
    sortDirection,
  ])
}

function dedupeAndTrim(fields: IndexFields, maxFields: number): IndexFields {
  return [...new Map(fields)].slice(0, maxFields)
}
