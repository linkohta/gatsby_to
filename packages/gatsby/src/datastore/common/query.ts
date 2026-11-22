import * as _ from "lodash"
import { prepareRegex } from "../../utils/prepare-regex"
import { makeRe } from "micromatch"

export interface IDbQueryQuery {
  type: "query"
  path: Array<string>
  query: IDbFilterStatement
}

export interface IDbQueryElemMatch {
  type: "elemMatch"
  path: Array<string>
  nestedQuery: DbQuery
}

export type DbQuery = IDbQueryQuery | IDbQueryElemMatch

export enum DbComparator {
  EQ = `$eq`,
  NE = `$ne`,
  GT = `$gt`,
  GTE = `$gte`,
  LT = `$lt`,
  LTE = `$lte`,
  IN = `$in`,
  NIN = `$nin`,
  REGEX = `$regex`,
  GLOB = `$glob`,
}

// TODO: DbComparatorValue と統合する
export type FilterValueNullable =
  | string
  | number
  | boolean
  | null
  | undefined
  | RegExp // $regex でだけ有効
  | Array<string | number | boolean | null | undefined>

// ほとんどの場合、これがフィルターの値である
export type FilterValue =
  | string
  | number
  | boolean
  | RegExp // $regex でだけ有効
  | Array<string | number | boolean>

// 値は任意のキーを持つオブジェクトで、各キーの値はフィルターの値か、
// 再帰的に同じ構造を持つオブジェクトである。例: `{a: {a: {a: 2}}}`
export interface IInputQuery {
  [key: string]: FilterValueNullable | IInputQuery
}
// IInputQuery に似ているが、比較演算子にあたる末端のノードは
// キーに `$` の接頭辞が付き、場合によっては値が正規化されている。
export interface IPreparedQueryArg {
  [key: string]: FilterValueNullable | IPreparedQueryArg
}

const DB_COMPARATOR_VALUES: Set<string> = new Set(Object.values(DbComparator))

function isDbComparator(value: string): value is DbComparator {
  return DB_COMPARATOR_VALUES.has(value)
}

export type DbComparatorValue = string | number | boolean | RegExp | null

export interface IDbFilterStatement {
  comparator: DbComparator
  value: DbComparatorValue | Array<DbComparatorValue>
}

/**
 * ネストした mongo の引数オブジェクトを DbQuery オブジェクトの配列に変換する。
 * これは、クエリの個々のパスを構造化して表したものである。複数のキーを持つ
 * ネストしたオブジェクトは、別々のインスタンスに変換する。
 */
export function createDbQueriesFromObject(
  filter: Record<string, any>
): Array<DbQuery> {
  return createDbQueriesFromObjectNested(filter)
}

function createDbQueriesFromObjectNested(
  filter: Record<string, any>,
  path: Array<string> = []
): Array<DbQuery> {
  const keys = Object.getOwnPropertyNames(filter)
  return _.flatMap(keys, (key: string): Array<DbQuery> => {
    if (key === `$elemMatch`) {
      const queries = createDbQueriesFromObjectNested(filter[key])
      return queries.map(query => {
        return {
          type: `elemMatch`,
          path: path,
          nestedQuery: query,
        }
      })
    } else if (isDbComparator(key)) {
      return [
        {
          type: `query`,
          path,
          query: {
            comparator: key,
            value: filter[key],
          },
        },
      ]
    } else {
      return createDbQueriesFromObjectNested(filter[key], path.concat([key]))
    }
  })
}

/**
 * DbQuery の構造を受け取り、このクエリが参照するフィールドのドット区切りの表現を返す。
 *
 * 例:
 * ```js
 *   const query = createDbQueriesFromObject({
 *     foo: { $elemMatch: { id: { $eq: 5 }, test: { $gt: 42 } } },
 *     bar: { $in: [`bar`] }
 *   })
 *   const result = query.map(dbQueryToDottedField)
 * ```
 * 戻り値:
 *   [`foo.id`, `foo.test`, `bar`]
 */
export function dbQueryToDottedField(query: DbQuery): string {
  const path: Array<string> = [...query.path]
  let currentQuery = query
  while (currentQuery.type === `elemMatch`) {
    currentQuery = currentQuery.nestedQuery
    path.push(...currentQuery.path)
  }
  return path.join(`.`)
}

export function getFilterStatement(dbQuery: DbQuery): IDbFilterStatement {
  let currentQuery = dbQuery
  while (currentQuery.type !== `query`) {
    currentQuery = currentQuery.nestedQuery
  }
  return currentQuery.query
}

export function prefixResolvedFields(
  queries: Array<DbQuery>,
  resolvedFields: Record<string, unknown>
): Array<DbQuery> {
  const dottedFields = objectToDottedField(resolvedFields)
  const dottedFieldKeys = Object.getOwnPropertyNames(dottedFields)
  queries.forEach(query => {
    const prefixPath = query.path.join(`.`)
    if (
      dottedFields[prefixPath] ||
      (dottedFieldKeys.some(dottedKey => dottedKey.startsWith(prefixPath)) &&
        query.type === `elemMatch`) ||
      dottedFieldKeys.some(dottedKey => prefixPath.startsWith(dottedKey))
    ) {
      query.path.unshift(`__gatsby_resolved`)
    }
  })
  return queries
}

/**
 * 入力の GraphQL クエリから来るフィルターを mongodb 互換の形式に変換する
 * （比較演算子に "$" の接頭辞を付ける）。
 *
 * 例:
 *   { foo: { eq: 5 } } -> { foo: { $eq: 5 }}
 */
export function prepareQueryArgs(
  filterFields: Array<IInputQuery> | IInputQuery = {}
): IPreparedQueryArg {
  const filters = {}
  Object.keys(filterFields).forEach(key => {
    const value = filterFields[key]
    if (_.isPlainObject(value)) {
      filters[key === `elemMatch` ? `$elemMatch` : key] = prepareQueryArgs(
        value as IInputQuery
      )
    } else {
      switch (key) {
        case `regex`:
          if (typeof value !== `string`) {
            throw new Error(
              `The $regex comparator is expecting the regex as a string, not an actual regex or anything else`
            )
          }
          filters[`$regex`] = prepareRegex(value)
          break
        case `glob`:
          filters[`$regex`] = makeRe(value)
          break
        default:
          filters[`$${key}`] = value
      }
    }
  })
  return filters
}

// ネストした mongo の引数オブジェクトをドット記法に変換する。acc
// （アキュムレーター）は空のオブジェクトへの参照でなければならない。変換した
// フィールドはそこに追加される。例:
//
// {
//   internal: {
//     type: {
//       $eq: "TestNode"
//     },
//     content: {
//       $regex: new MiniMatch(v)
//     }
//   },
//   id: {
//     $regex: newMiniMatch(v)
//   }
// }
//
// 実行後、acc は次のようになる:
//
// {
//   "internal.type": {
//     $eq: "TestNode"
//   },
//   "internal.content": {
//     $regex: new MiniMatch(v)
//   },
//   "id": {
//     $regex: // as above
//   }
// }

// 上と同様だが、$elemMatch は扱わない
export function objectToDottedField(
  obj: Record<string, unknown>,
  path: Array<string> = []
): Record<string, unknown> {
  let result = {}
  Object.keys(obj).forEach(key => {
    const value = obj[key]
    if (_.isPlainObject(value)) {
      const pathResult = objectToDottedField(
        value as Record<string, unknown>,
        path.concat(key)
      )
      result = {
        ...result,
        ...pathResult,
      }
    } else {
      result[path.concat(key).join(`.`)] = value
    }
  })
  return result
}

const comparatorSpecificity = {
  [DbComparator.EQ]: 80,
  [DbComparator.IN]: 70,
  [DbComparator.GTE]: 60,
  [DbComparator.LTE]: 50,
  [DbComparator.GT]: 40,
  [DbComparator.LT]: 30,
  [DbComparator.NIN]: 20,
  [DbComparator.NE]: 10,
}

export function sortBySpecificity(all: Array<DbQuery>): Array<DbQuery> {
  return [...all].sort(compareBySpecificityDesc)
}

function compareBySpecificityDesc(a: DbQuery, b: DbQuery): number {
  const aComparator = getFilterStatement(a).comparator
  const bComparator = getFilterStatement(b).comparator
  if (aComparator === bComparator) {
    return 0
  }
  const aSpecificity = comparatorSpecificity[aComparator]
  const bSpecificity = comparatorSpecificity[bComparator]
  if (!aSpecificity || !bSpecificity) {
    throw new Error(
      `Unexpected comparator pair: ${aComparator}, ${bComparator}`
    )
  }
  return aSpecificity > bSpecificity ? -1 : 1
}
