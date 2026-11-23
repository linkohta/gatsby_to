import { IGatsbyNode } from "../../redux/types"
import {
  IDbQueryElemMatch,
  FilterValue,
  FilterValueNullable,
  objectToDottedField,
} from "../common/query"
import { getDataStore, getNode } from "../"
import _ from "lodash"
import { getValueAt } from "../../utils/get-value-at"
import { getResolvedFields } from "../../schema/utils"

// 対応している演算子だけをここに列挙する。"CacheableFilterOp"
// TODO: DbComparator と統合するか
export type FilterOp =
  `$eq` | `$ne` | `$lt` | `$lte` | `$gt` | `$gte` | `$in` | `$nin` | `$regex` // 注: これは $glob を含む

export type FilterCacheKey = string
type GatsbyNodeID = string

export interface IGatsbyNodePartial {
  id: GatsbyNodeID
  internal: {
    type: string
    counter: number
  }
  gatsbyNodePartialInternalData: {
    indexFields: Set<string>
  }
  [k: string]: any
}

const nodeIdToIdentifierMap = new Map<
  GatsbyNodeID,
  WeakRef<IGatsbyNodePartial>
>()

/**
 * 指定したノードに対応する IGatsbyNodePartial のインスタンスを取得する。
 * 入力として IGatsbyNode または IGatsbyNodePartial を受け取る。これにより、
 * partial にまだ保存されていないインデックスフィールドに出会ったときに、
 * 条件付きで partial に保存できる。
 */
export const getGatsbyNodePartial = (
  node: IGatsbyNode | IGatsbyNodePartial,
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): IGatsbyNodePartial => {
  // まず、キャッシュに partial があるかを確認する
  const cacheKey = `${node.id}_____${node.internal.counter}`
  let derefPartial: IGatsbyNodePartial | undefined = undefined
  if (nodeIdToIdentifierMap.has(cacheKey)) {
    derefPartial = nodeIdToIdentifierMap.get(cacheKey)?.deref()

    // 次に、メモリ上にあり、必要なフィールドをすべて持っているかを確認する
    if (
      derefPartial &&
      _.every(
        indexFields.map(field =>
          derefPartial!.gatsbyNodePartialInternalData.indexFields.has(field)
        )
      )
    ) {
      return derefPartial
    }
  }

  // フィールドのキーをすべて見つけ、キーとその値を partial に保存する
  // この partial がすでに渡されている場合は、両方のインデックスフィールドの集合をマージする
  const dottedFields = {}
  const fieldsToStore = derefPartial
    ? new Set([
        ...derefPartial.gatsbyNodePartialInternalData.indexFields,
        ...indexFields,
      ])
    : new Set(indexFields)

  const sortFieldIds = getSortFieldIdentifierKeys(
    [...fieldsToStore],
    resolvedFields
  )
  let fullNodeObject: IGatsbyNode | undefined =
    node.gatsbyNodePartialInternalData ? undefined : (node as IGatsbyNode)
  let resolvedNodeFields

  for (const dottedField of sortFieldIds) {
    if (dottedField in node) {
      dottedFields[dottedField] = node[dottedField]
    } else {
      if (dottedField.startsWith(`__gatsby_resolved.`)) {
        if (!resolvedNodeFields) {
          resolvedNodeFields = getResolvedFields(node)
        }

        dottedFields[dottedField] = getValueAt(
          resolvedNodeFields,
          dottedField.slice(`__gatsby_resolved.`.length)
        )
      } else {
        // 完全なノードオブジェクトをまだ取得していない場合は、1 回だけ取得する
        // 完全なノードオブジェクトを使って値を取得する
        if (!fullNodeObject) {
          fullNodeObject = getNode(node.id)!
        }
        dottedFields[dottedField] = getValueAt(fullNodeObject, dottedField)
      }
    }
  }

  // partial オブジェクトを作成する
  const partial = Object.assign(dottedFields, {
    id: node.id,
    internal: {
      counter: node.internal.counter,
      type: node.internal.type,
    },
    gatsbyNodePartialInternalData: {
      indexFields: fieldsToStore,
    },
  })

  // 後で取得できるよう、オブジェクトをキャッシュに設定する
  nodeIdToIdentifierMap.set(cacheKey, new WeakRef<IGatsbyNodePartial>(partial))

  return partial
}

const sortByIds = (a: IGatsbyNodePartial, b: IGatsbyNodePartial): number =>
  a.internal.counter - b.internal.counter

export interface IFilterCache {
  op: FilterOp
  // このマップでは、`undefined` の値はそのパスを持たなかったノードを表す
  // 個々の配列は internal.counter の昇順に並んでいる。これにより
  // 挿入順が保たれ、一意性が保証される。また、数値なので
  // .sort() の呼び出しで単に引き算ができて都合がよい :)
  // これらの配列は重複を含むことがある (!)。重複は最後のステップでしか
  // 取り除かれないためである。
  // TODO: eq のパフォーマンスのために、これらのバケットを確実に重複なしにすることを検討する
  byValue: Map<FilterValueNullable, Array<IGatsbyNodePartial>>
  meta: {
    // ne/nin が使う。この配列から Set を作り、別の Set を取り除いてからソートする
    nodesUnordered?: Array<IGatsbyNodePartial>
    // 要求された型のすべてのノードを平坦にした一覧。counter の順に並ぶ（フィルターが空の場合のためにキャッシュする）
    orderedByCounter?: Array<IGatsbyNodePartial>
    // このフィルターで見つかったすべての値の順序付きの一覧（`<` による）。null と undefined は含まない
    valuesAsc?: Array<FilterValue>
    // ノードを平坦にした一覧。valueAsc の順に並ぶ
    nodesByValueAsc?: Array<IGatsbyNodePartial>
    // 値ごとのノードの範囲。nodesByValueAsc 配列に対応する
    valueRangesAsc?: Map<FilterValue, [number, number]>
    // このフィルターで見つかったすべての値の順序付きの一覧（`>` による）。null と undefined は含まない
    valuesDesc?: Array<FilterValue>
    // ノードを平坦にした一覧。valueDesc の順に並ぶ
    nodesByValueDesc?: Array<IGatsbyNodePartial>
    // 値ごとのノードの範囲。nodesByValueDesc 配列に対応する
    valueRangesDesc?: Map<FilterValue, [number, number]>
  }
}
export type FiltersCache = Map<FilterCacheKey, IFilterCache>

export function postIndexingMetaSetup(
  filterCache: IFilterCache,
  op: FilterOp
): void {
  // byValue をループし、バケットが counter の順にソートされているようにする
  // 挿入ソートをしていないので、後から行う必要がある
  for (const bucket of filterCache.byValue) {
    bucket[1].sort(sortByIds)
  }

  if (op === `$ne` || op === `$nin`) {
    postIndexingMetaSetupNeNin(filterCache)
  } else if ([`$lt`, `$lte`, `$gt`, `$gte`].includes(op)) {
    postIndexingMetaSetupLtLteGtGte(filterCache, op)
  }
}

function postIndexingMetaSetupNeNin(filterCache: IFilterCache): void {
  // 注: `null` と `undefined` に関するエッジケース。ここでの `undefined` は、
  // プロパティが存在しなかったことを示す。フィルターは実際の
  // `undefined` の値に対応していないためである。
  // $ne では、`null` はそのプロパティを実際に持つノードだけを返す。
  // その場合、プロパティは `null` でもありえない。それ以外の値では、
  // $ne は値が実際に needle ではないすべてのノードを返す。
  // 値が null のノードも含む。
  // $nin は $ne と同じことをするが、1 つではなく複数の値を
  // 除外する点が異なる。
  // `$ne` では、対象となるすべてのノードの一覧を取り、特定の値を持つ
  // ノードのバケットが存在すれば、それを除外する。

  const arr: Array<IGatsbyNodePartial> = []
  filterCache.meta.nodesUnordered = arr
  filterCache.byValue.forEach(v => {
    v.forEach(nodeId => {
      arr.push(nodeId)
    })
  })
}

function postIndexingMetaSetupLtLteGtGte(
  filterCache: IFilterCache,
  op: FilterOp
): void {
  // 個々のノードの順序付きの配列を作成する。フィルターの解決結果の値で
  // 並べる（グループ化する）。値ごとのノードは
  // internal.counter の昇順に並ぶ。
  // こうしておくと、eq 以外の演算子は配列をスライスするだけで範囲を取得できる。

  const entriesNullable: Array<
    [FilterValueNullable, Array<IGatsbyNodePartial>]
  > = [...filterCache.byValue.entries()]

  // これらの範囲チェックは `null` や `undefined` を返さないので、取り除いておく
  // 早い段階で取り除くことで、ソートが速くなるはずである。おそらく ...
  const entries: Array<[FilterValue, Array<IGatsbyNodePartial>]> =
    entriesNullable.filter(([v]) => v != null) as Array<
      [FilterValue, Array<IGatsbyNodePartial>]
    >

  // すべての配列を値の昇順でソートする。型変換が起こる可能性は無視（許容）する。
  // 注: `<` は `>=` の逆だが、順序付けの際に値が型変換されることがある。
  // この型変換により、演算は冪等ではなくなる（通常は、同じ型の任意の a と b について、
  // `a < b` の結果は `b >= a` の逆になる）。例外は
  // `NaN` である数値だが、これはユーザーのコードのバグである可能性が高いので、
  // ここでは無視している。しかし、型変換の結果、演算が `NaN` と
  // 比較することになる場合もある。例: `("abc" <= 12) !== (12 > "abc")`
  // これは結局 `NaN <= 12` と `NaN > "abc"` を行うことになり、どちらも
  // false になる。
  // そのため、昇順と降順の 2 つの順序付きの一覧を持つことがある。
  // 一方の逆ともう一方を比較したときの違いは、これらの `NaN` のケースが
  // どう並ぶかだけのはずである。
  // `lt` と `lte` が同じ順序付きの一覧を使うのは問題ない。gt/gte も同様である。
  if (op === `$lt` || op === `$lte`) {
    // 昇順に並べる。最初の値が最小
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  } else if (op === `$gt` || op === `$gte`) {
    // 降順に並べる。最初の値が最大
    entries.sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
  }

  const orderedNodes: Array<IGatsbyNodePartial> = []
  const orderedValues: Array<FilterValue> = []
  const offsets: Map<FilterValue, [number, number]> = new Map()
  entries.forEach(([v, bucket]: [FilterValue, Array<IGatsbyNodePartial>]) => {
    // フィルターの値が v であるすべてのノードを含む範囲を記録する
    // 範囲の最後の値は、次の値のオフセットになるはずである
    // （つまり、`nodes.slice(start, stop)` で取得できるはずである）
    offsets.set(v, [orderedNodes.length, orderedNodes.length + bucket.length])
    // ここで `arr.push(...bucket)` とすることもできるが、非常に大きな集合では
    // 安全ではないので、通常のループを使う
    bucket.forEach(node => orderedNodes.push(node))
    orderedValues.push(v)
  })

  if (op === `$lt` || op === `$lte`) {
    filterCache.meta.valuesAsc = orderedValues
    filterCache.meta.nodesByValueAsc = orderedNodes
    // nodesByValueAsc は値の順に並んでいるが、同じ値を持つ複数のノードは
    // 並んでいない。lt を lte と同じ速さにするには、各値の開始と終了の
    // インデックスを知っている必要がある。`ne` でも同様に役立つ。
    filterCache.meta.valueRangesAsc = offsets
  } else if (op === `$gt` || op === `$gte`) {
    filterCache.meta.valuesDesc = orderedValues
    filterCache.meta.nodesByValueDesc = orderedNodes
    // nodesByValueDesc は値の順に並んでいるが、同じ値を持つ複数のノードは
    // 並んでいない。gt を gte と同じ速さにするには、各値の開始と終了の
    // インデックスを知っている必要がある。`ne` でも同様に役立つ。
    filterCache.meta.valueRangesDesc = offsets
  }
}

/**
 * elemMatch ではない単一のフィルターパス、ノードの型の一覧、キャッシュを
 * 受け取り、フィルターの結果の値ごとに、該当するすべてのノードを
 * 一覧として持つキャッシュを作成する。
 * このキャッシュはフィルターの適用に使う。ページ（ノード）の数が増えたときに、
 * すべてのノードをループするのに比べて大幅な改善になる。
 */
export const ensureIndexByQuery = (
  op: FilterOp,
  filterCacheKey: FilterCacheKey,
  filterPath: Array<string>,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): void => {
  const filterCache: IFilterCache = {
    op,
    byValue: new Map<FilterValueNullable, Array<IGatsbyNodePartial>>(),
    meta: {},
  } as IFilterCache
  filtersCache.set(filterCacheKey, filterCache)

  // ノードの部分集合を型ごとにキャッシュするが、1 つの型だけである。そのため、
  // 1 つのノードの型を検索する場合は、すべてのノードの検索を避けられる。そうでない場合は、
  // すべてのノードをループするほうがおそらく速い。たぶん。もしかすると。

  if (nodeTypeNames.length === 1) {
    getDataStore()
      .iterateNodesByType(nodeTypeNames[0])
      .forEach(node => {
        addNodeToFilterCache({
          node,
          chain: filterPath,
          filterCache,
          indexFields,
          resolvedFields,
        })
      })
  } else {
    // ここでは、まずノードの型で絞り込む必要がある
    // このループは規模が大きいとコストが高い (!)
    getDataStore()
      .iterateNodes()
      .forEach(node => {
        if (!nodeTypeNames.includes(node.internal.type)) {
          return
        }

        addNodeToFilterCache({
          node,
          chain: filterPath,
          filterCache,
          indexFields,
          resolvedFields,
        })
      })
  }

  postIndexingMetaSetup(filterCache, op)
}

export function ensureEmptyFilterCache(
  filterCacheKey,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): void {
  // フィルターが 1 つもないクエリで呼ばれる
  // 結果は基本的に型ごとのノードの一覧なので、キャッシュしておきたい
  // 空のクエリを複数持つサイトがある

  const orderedByCounter: Array<IGatsbyNodePartial> = []

  filtersCache.set(filterCacheKey, {
    op: `$eq`, // 無視する。
    byValue: new Map<FilterValueNullable, Array<IGatsbyNodePartial>>(),
    meta: {
      orderedByCounter, // これが求めているもの
    },
  })

  if (nodeTypeNames.length === 1) {
    getDataStore()
      .iterateNodesByType(nodeTypeNames[0])
      .forEach(node => {
        orderedByCounter.push(
          getGatsbyNodePartial(node, indexFields, resolvedFields)
        )
      })
  } else {
    // ここでは、まずノードの型で絞り込む必要がある
    // このループは規模が大きいとコストが高い (!)
    getDataStore()
      .iterateNodes()
      .forEach(node => {
        if (nodeTypeNames.includes(node.internal.type)) {
          orderedByCounter.push(
            getGatsbyNodePartial(node, indexFields, resolvedFields)
          )
        }
      })
  }

  // 各ノードは型を 1 つしか持てないので、この配列での重複を心配する
  // 必要はないはずである。ソートされていることだけを保証する。
  orderedByCounter.sort(sortByIds)
}

function addNodeToFilterCache({
  node,
  chain,
  filterCache,
  indexFields,
  resolvedFields,
  valueOffset = node,
}: {
  node: IGatsbyNode
  chain: Array<string>
  filterCache: IFilterCache
  indexFields: Array<string>
  resolvedFields: Record<string, any>
  valueOffset?: any
}): void {
  // - 通常のクエリでは、valueOffset === node
  // - elemMatch では、valueOffset は照合を続けるノードのサブツリー
  let v = valueOffset as any
  let i = 0
  while (i < chain.length && v) {
    const nextProp = chain[i++]
    if (i === 1 && nextProp === `__gatsby_resolved`) {
      v = getResolvedFields(v)
    } else {
      v = v[nextProp]
    }
  }

  if (
    (typeof v !== `string` &&
      typeof v !== `number` &&
      typeof v !== `boolean` &&
      v !== null) ||
    i !== chain.length
  ) {
    if (i === chain.length && Array.isArray(v)) {
      // 演算子の解決結果が配列だった
      // 配列の各要素についてエントリーを追加する。これは eq や ne のような
      // 演算子では機能するが、lt、lte、gt、gte のような範囲の演算子については不明である。

      v.forEach(v =>
        markNodeForValue(filterCache, node, v, indexFields, resolvedFields)
      )

      return
    }

    // これは次のどちらかを意味する
    // - フィルターの解決結果が `undefined` だった
    // - フィルターの解決結果がプリミティブ以外だった
    // 値を `undefined` に設定し、「パスが（完全には）存在しない」ことを示す
    v = undefined
  }

  markNodeForValue(filterCache, node, v, indexFields, resolvedFields)
}

function markNodeForValue(
  filterCache: IFilterCache,
  node: IGatsbyNode,
  value: FilterValueNullable,
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): void {
  let arr = filterCache.byValue.get(value)
  if (!arr) {
    arr = []
    filterCache.byValue.set(value, arr)
  }

  const partial = getGatsbyNodePartial(node, indexFields, resolvedFields)
  if (!arr.includes(partial)) {
    arr.push(partial)
  }
}

export const ensureIndexByElemMatch = (
  op: FilterOp,
  filterCacheKey: FilterCacheKey,
  filter: IDbQueryElemMatch,
  nodeTypeNames: Array<string>,
  filtersCache: FiltersCache,
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): void => {
  // elemMatch フィルターを受け取り、そのサブクエリで指定した値に一致する
  // すべてのノードを含むキャッシュを生成する

  const filterCache: IFilterCache = {
    op,
    byValue: new Map<FilterValueNullable, Array<IGatsbyNodePartial>>(),
    meta: {},
  } as IFilterCache
  filtersCache.set(filterCacheKey, filterCache)

  if (nodeTypeNames.length === 1) {
    getDataStore()
      .iterateNodesByType(nodeTypeNames[0])
      .forEach(node => {
        addNodeToBucketWithElemMatch({
          node,
          valueAtCurrentStep: node,
          filter,
          filterCache,
          indexFields,
          resolvedFields,
        })
      })
  } else {
    // 規模が大きいとコストが高い
    getDataStore()
      .iterateNodes()
      .forEach(node => {
        if (!nodeTypeNames.includes(node.internal.type)) {
          return
        }

        addNodeToBucketWithElemMatch({
          node,
          valueAtCurrentStep: node,
          filter,
          filterCache,
          indexFields,
          resolvedFields,
        })
      })
  }

  postIndexingMetaSetup(filterCache, op)
}

function addNodeToBucketWithElemMatch({
  node,
  valueAtCurrentStep, // ノード内のパス上の任意のステップ
  filter,
  filterCache,
  indexFields,
  resolvedFields,
}: {
  node: IGatsbyNode
  valueAtCurrentStep: any // ノード内のパス上の任意のステップ
  filter: IDbQueryElemMatch
  filterCache: IFilterCache
  indexFields: Array<string>
  resolvedFields: Record<string, any>
}): void {
  const { path, nestedQuery } = filter

  // elemMatch を適用する値を見つける
  let i = 0
  while (i < path.length && valueAtCurrentStep) {
    const nextProp = path[i++]
    if (i === 1 && nextProp === `__gatsby_resolved`) {
      valueAtCurrentStep = getResolvedFields(valueAtCurrentStep)
    } else {
      valueAtCurrentStep = valueAtCurrentStep[nextProp]
    }
  }

  if (path.length !== i) {
    // パスの終わりに達する前に undefined が見つかった
    return
  }

  // `v` はここで elemMatch の対象になっているはずである。おそらく配列だが、そうでないこともある
  if (!Array.isArray(valueAtCurrentStep)) {
    // 配列以外に対して `elemMatch` することも可能なので、それにも対応する
    valueAtCurrentStep = [valueAtCurrentStep]
  }

  // 注: すべての要素を確認する必要がある。ノードを複数のバケットに追加しなければ
  // ならないことがあるためである（`{a:[{b:3},{b:4}]}` の場合、`a.elemMatch.b/eq` では
  // そのノードは値 3 と 4 のバケットに入る）。要素が同じ値に解決されると
  // 作業が重複することがあるが、それは避けられない。
  valueAtCurrentStep.forEach(elem => {
    if (nestedQuery.type === `elemMatch`) {
      addNodeToBucketWithElemMatch({
        node,
        valueAtCurrentStep: elem,
        filter: nestedQuery,
        filterCache,
        indexFields,
        resolvedFields,
      })
    } else {
      // ここからは、elemMatch ではないフィルターと同じ経路をたどる
      addNodeToFilterCache({
        node,
        chain: nestedQuery.path,
        filterCache,
        indexFields,
        resolvedFields,
        valueOffset: elem,
      })
    }
  })
}

const binarySearchAsc = (
  values: Array<FilterValue>, // 昇順に並んでいると仮定する
  needle: FilterValue
): [number, number] | undefined => {
  let min = 0
  let max = values.length - 1
  let pivot = Math.floor(values.length / 2)
  while (min <= max) {
    const value = values[pivot]
    if (needle < value) {
      // ピボットを、現在のピボットより左にあるノードの中央へ移す
      // assert pivot < max
      max = pivot
    } else if (needle > value) {
      // ピボットを、現在のピボットより右にあるノードの中央へ移す
      // assert pivot > min
      min = pivot
    } else {
      // これは needle === value を意味する
      // TODO: NaN の場合と、おそらく一部の型変換のケースは除く
      return [pivot, pivot]
    }

    if (max - min <= 1) {
      // 探索の終わり。needle は見つからなかった（想定どおり）。ピボットをインデックスとして使う。
      // needle が見つからなかった場合は max-min==1 であり、max が返される。
      return [min, max]
    }

    pivot = min + Math.floor((max - min) / 2)
  }

  // 到達しないはず
  return undefined
}
const binarySearchDesc = (
  values: Array<FilterValue>, // 降順に並んでいると仮定する
  needle: FilterValue
): [number, number] | undefined => {
  let min = 0
  let max = values.length - 1
  let pivot = Math.floor(values.length / 2)
  while (min <= max) {
    const value = values[pivot]
    if (needle < value) {
      // ピボットを、現在のピボットより右にあるノードの中央へ移す
      // assert pivot < min
      min = pivot
    } else if (needle > value) {
      // ピボットを、現在のピボットより左にあるノードの中央へ移す
      // assert pivot > max
      max = pivot
    } else {
      // これは needle === value を意味する
      // TODO: NaN の場合と、おそらく一部の型変換のケースは除く
      return [pivot, pivot]
    }

    if (max - min <= 1) {
      // 探索の終わり。needle は見つからなかった（想定どおり）。ピボットをインデックスとして使う。
      // needle が見つからなかった場合は max-min==1 であり、max が返される。
      return [min, max]
    }

    pivot = min + Math.floor((max - min) / 2)
  }

  // 到達しないはず
  return undefined
}

/**
 * フィルターのキャッシュキーと対象の値を受け取り、その値に解決されるノードの
 * 一覧を返す。返される配列は id の順に並んでいるはずである。
 * 該当するノードがない場合は `undefined` を返す
 *
 * 基本的に、フィルターが {a: {b: {slug: {eq: "foo/bar"}}}} であれば、
 * `node.slug === "foo/bar"` であるすべてのノードを返す。slug の場合は通常
 * （常にではないが）多くても 1 ノードだが、このフィルターは何にでも適用できる。
 *
 * この関数が返す配列は internal.counter の順に並んでいなければならず、
 * 重複するノードを含んではならない (!)
 */
export const getNodesFromCacheByValue = (
  filterCacheKey: FilterCacheKey,
  filterValue: FilterValueNullable,
  filtersCache: FiltersCache,
  wasElemMatch
): Array<IGatsbyNodePartial> | undefined => {
  const filterCache = filtersCache.get(filterCacheKey)
  if (!filterCache) {
    return undefined
  }

  const op = filterCache.op

  if (op === `$eq`) {
    // byValue 内の配列は counter の順に並んでいると仮定する

    if (filterValue == null) {
      // null のエッジケース。`null` と `undefined` のすべてのノードを取得する。
      // `$eq` は、`null` を検索するときにパスを持たないノードも返すためである。
      // すべての演算子がそうするわけではないので、存在しないパスは `undefined` に対応付ける。

      const arrNull = filterCache.byValue.get(null) ?? []
      const arrUndef = filterCache.byValue.get(undefined) ?? []

      // 2 つの（順序付きの）配列をマージし、重複のない順序付きの配列を返す
      // TODO: このマージ済みの一覧を単にキャッシュできない理由はまだ残っているか
      return unionNodesByCounter(arrNull, arrUndef)
    }

    return filterCache.byValue.get(filterValue)
  }

  if (op === `$in`) {
    if (!Array.isArray(filterValue)) {
      throw new Error("The argument to the `in` comparator should be an array")
    }
    const filterValueArr: Array<FilterValueNullable> = filterValue

    const set: Set<IGatsbyNodePartial> = new Set()

    // TODO: ステップごとにマージソートすることもできる。JS のメモリの仕組み上、こちらのほうが遅くなるかもしれない。
    // needle 配列の各値について、その値に対応するノードのバケットを見つけ、
    // そのバケットを 1 つの一覧に追加して、その一覧を返す。
    filterValueArr.forEach((v: FilterValueNullable) =>
      filterCache.byValue.get(v)?.forEach(v => set.add(v))
    )

    const arr = [...set] // パフォーマンスには悪いが、一意な集合であることが保証される :(
    arr.sort(sortByIds)

    // 注: フィルターの値の一覧が大きくなることはまずないので、ここでは .includes で問題ないはずである
    if (filterValueArr.includes(null)) {
      // 他のすべての演算子と同様に、`in: [null]` は奇妙な動作をし、
      // （完全な）パスを実際には持たない（v=undefined）すべてのノードを許容する
      const nodes = filterCache.byValue.get(undefined)
      if (nodes) {
        // これは重複の除去も行うので、すぐには行わない
        return unionNodesByCounter(nodes, arr)
      }
    }

    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、先に重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }

    return arr
  }

  if (op === `$nin`) {
    // これは本質的に $ne 演算子と同じで、除外する値が
    // 複数になっただけである。

    if (!Array.isArray(filterValue)) {
      throw new Error(`The $nin operator expects an array as value`)
    }

    const values: Set<FilterValueNullable> = new Set(filterValue)
    const set = new Set(filterCache.meta.nodesUnordered)

    // 値の集合の各要素について、"$ne" の処理を行う
    values.forEach(filterValue => {
      removeBucketFromSet(filterValue, filterCache, set)
    })

    // TODO: 再ソートが不要になるような形で集合の差を求める、
    //       より効率的なアルゴリズムがおそらくある
    return [...set].sort(sortByIds)
  }

  if (op === `$ne`) {
    const set = new Set(filterCache.meta.nodesUnordered)

    removeBucketFromSet(filterValue, filterCache, set)

    // TODO: ここで再ソートが不要になるような形で集合の差を求める、
    //       より効率的なアルゴリズムがおそらくある
    return [...set].sort(sortByIds)
  }

  if (op === `$regex`) {
    // 注: $glob は $regex に変換されるので、$glob フィルターもここを通る
    // 入力パターンの形式を除けば、その後の挙動はまったく同じである。

    // フィルターへの入力は文字列でなければならない（先頭と末尾のスラッシュ、および正規表現のフラグを含む）
    // フィルターがここに到達するまでに、filterValue は正規表現になっていなければならない。

    if (!(filterValue instanceof RegExp)) {
      throw new Error(
        `The value for the $regex comparator must be an instance of RegExp`
      )
    }
    const regex = filterValue

    const arr: Array<IGatsbyNodePartial> = []
    filterCache.byValue.forEach((nodes, value) => {
      // TODO: $regex では値は文字列でなければならないのか。文字列以外は自動的に無視できるのか。それとも型変換されるのか。
      // 注: 歴史的な理由により、正規表現では部分的なパスも含めるべきである
      if (value !== undefined && regex.test(String(value))) {
        nodes.forEach(node => arr.push(node))
      }
    })

    // TODO: この一覧もキャッシュ _できる_。$regex が主にリテラルで使われていると分かれば、意味があるかもしれない
    // TODO: まずすべてのバケットを集めてから .concat する、またはマージソートするほうがよいかもしれない

    arr.sort(sortByIds)

    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }

    return arr
  }

  if (filterValue == null) {
    if (op === `$lt` || op === `$gt`) {
      // null より小さい、または大きいものはない
      return undefined
    }

    // これはエッジケースであり、この値は直接インデックス化されているはずである
    // `lte`/`gte` では、「範囲」ではなく `null` のノードだけを返すべきである
    return filterCache.byValue.get(filterValue)
  }

  if (Array.isArray(filterValue)) {
    throw new Error(
      "Array is an invalid filter value for the `" + op + "` comparator"
    )
  }

  if (filterValue instanceof RegExp) {
    // これは内部エラーである可能性が高い。ただし、ユーザーがこの API を
    // より直接的に呼び出すことも可能である。
    throw new Error(
      `A RegExp instance is only valid for $regex and $glob comparators`
    )
  }

  if (op === `$lt`) {
    // まず直接の方法を試す。クエリされた値がそのまま存在する場合は、
    // リスト全体の二分探索を省ける。O(1) 対 O(log n) である

    const ranges = filterCache.meta.valueRangesAsc
    const nodes = filterCache.meta.nodesByValueAsc

    const range = ranges!.get(filterValue)
    if (range) {
      const arr = nodes!.slice(0, range[0])
      arr.sort(sortByIds)
      // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
      if (wasElemMatch) {
        expensiveDedupeInline(arr)
      }
      return arr
    }

    // クエリは、リストにない値を求めることがある。たとえばリストが
    // [1, 2, 5, 6] で、クエリが <= 3 の場合である。その場合は、スライスの
    // 開始位置を決めるために探索（二分探索を使う）を行う必要がある。

    // 注: lte の場合、この時点で valueAsc 配列はリストになっていなければならない
    const values = filterCache.meta.valuesAsc as Array<FilterValue>
    // targetValue は見つからないはずだが（見つかることもある）、targetValue を
    // 挟む 2 つの値のインデックス、または最初か最後の要素を返す。
    const point = binarySearchAsc(values, filterValue)
    if (!point) {
      return undefined
    }
    const [pivotMin, pivotMax] = point

    // 各ピボットのインデックスには値と範囲がなければならない
    // 返される min/max のインデックスは下限や上限を含むことがあるので、
    // 両方の値に対して lte のチェックが必要である。
    let pivotValue = values[pivotMax]
    if (pivotValue > filterValue) {
      pivotValue = values[pivotMin]
    }

    // 注: ピボットの値はフィルターの値と一致 _しないはず_ である。一致するなら
    // 値が実際に見つかったことになるが、そうした値はインデックス化されているので、
    // 上の .get() で結果が得られていたはずである。

    const [exclPivot, inclPivot] = ranges!.get(pivotValue) as [number, number]

    // 注: 厳密には `5 <= "5" === true` だが、`5` はキャッシュされない。
    // そのため、緩い比較を考慮する必要があり、ピボットを含めなければならないことがある
    const until = pivotValue < filterValue ? inclPivot : exclPivot
    const arr = nodes!.slice(0, until)
    arr.sort(sortByIds)
    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }
    return arr
  }

  if (op === `$lte`) {
    // まず直接の方法を試す。クエリされた値がそのまま存在する場合は、
    // リスト全体の二分探索を省ける。O(1) 対 O(log n) である

    const ranges = filterCache.meta.valueRangesAsc
    const nodes = filterCache.meta.nodesByValueAsc

    const range = ranges!.get(filterValue)
    if (range) {
      const arr = nodes!.slice(0, range[1])
      arr.sort(sortByIds)
      // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
      if (wasElemMatch) {
        expensiveDedupeInline(arr)
      }
      return arr
    }

    // クエリは、リストにない値を求めることがある。たとえばリストが
    // [1, 2, 5, 6] で、クエリが <= 3 の場合である。その場合は、スライスの
    // 開始位置を決めるために探索（二分探索を使う）を行う必要がある。

    // 注: lte の場合、この時点で valueAsc 配列はリストになっていなければならない
    const values = filterCache.meta.valuesAsc as Array<FilterValue>
    // targetValue は見つからないはずだが（見つかることもある）、targetValue を
    // 挟む 2 つの値のインデックス、または最初か最後の要素を返す。
    const point = binarySearchAsc(values, filterValue)
    if (!point) {
      return undefined
    }
    const [pivotMin, pivotMax] = point

    // 各ピボットのインデックスには値と範囲がなければならない
    // 返される min/max のインデックスは下限や上限を含むことがあるので、
    // 両方の値に対して lte のチェックが必要である。
    let pivotValue = values[pivotMax]
    if (pivotValue > filterValue) {
      pivotValue = values[pivotMin]
    }

    // 注: ピボットの値はフィルターの値と一致 _しないはず_ である。一致するなら
    // 値が実際に見つかったことになるが、そうした値はインデックス化されているので、
    // 上の .get() で結果が得られていたはずである。

    const [exclPivot, inclPivot] = ranges!.get(pivotValue) as [number, number]

    // 注: 厳密には `5 <= "5" === true` だが、`5` はキャッシュされない。
    // そのため、緩い比較を考慮する必要があり、ピボットを含めなければならないことがある
    const until = pivotValue <= filterValue ? inclPivot : exclPivot
    const arr = nodes!.slice(0, until)
    arr.sort(sortByIds)
    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }
    return arr
  }

  if (op === `$gt`) {
    // まず直接の方法を試す。クエリされた値がそのまま存在する場合は、
    // リスト全体の二分探索を省ける。O(1) 対 O(log n) である

    const ranges = filterCache.meta.valueRangesDesc
    const nodes = filterCache.meta.nodesByValueDesc

    const range = ranges!.get(filterValue)
    if (range) {
      const arr = nodes!.slice(0, range[0]).reverse()
      arr.sort(sortByIds)
      // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
      if (wasElemMatch) {
        expensiveDedupeInline(arr)
      }
      return arr
    }

    // クエリは、リストにない値を求めることがある。たとえばリストが
    // [1, 2, 5, 6] で、クエリが <= 3 の場合である。その場合は、スライスの
    // 開始位置を決めるために探索（二分探索を使う）を行う必要がある。

    // 注: gte の場合、この時点で valueDesc 配列はリストになっていなければならない
    const values = filterCache.meta.valuesDesc as Array<FilterValue>
    // targetValue は見つからないはずだが（見つかることもある）、targetValue を
    // 挟む 2 つの値のインデックス、または最初か最後の要素を返す。
    const point = binarySearchDesc(values, filterValue)
    if (!point) {
      return undefined
    }
    const [pivotMin, pivotMax] = point

    // 各ピボットのインデックスには値と範囲がなければならない
    // 返される min/max のインデックスは下限や上限を含むことがあるので、
    // 両方の値に対して gte のチェックが必要である。
    let pivotValue = values[pivotMax]
    if (pivotValue < filterValue) {
      pivotValue = values[pivotMin]
    }

    // 注: ピボットの値はフィルターの値と一致 _しないはず_ である。一致するなら
    // 値が実際に見つかったことになるが、そうした値はインデックス化されているので、
    // 上の .get() で結果が得られていたはずである。

    const [exclPivot, inclPivot] = ranges!.get(pivotValue) as [number, number]

    // 注: 厳密には `5 >= "5" === true` だが、`5` はキャッシュされない。
    // そのため、緩い比較を考慮する必要があり、ピボットを含めなければならないことがある
    const until = pivotValue > filterValue ? inclPivot : exclPivot
    const arr = nodes!.slice(0, until).reverse()
    arr.sort(sortByIds)
    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }
    return arr
  }

  if (op === `$gte`) {
    // まず直接の方法を試す。クエリされた値がそのまま存在する場合は、
    // リスト全体の二分探索を省ける。O(1) 対 O(log n) である

    const ranges = filterCache.meta.valueRangesDesc
    const nodes = filterCache.meta.nodesByValueDesc

    const range = ranges!.get(filterValue)
    if (range) {
      const arr = nodes!.slice(0, range[1]).reverse()
      arr.sort(sortByIds)
      // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
      if (wasElemMatch) {
        expensiveDedupeInline(arr)
      }
      return arr
    }

    // クエリは、リストにない値を求めることがある。たとえばリストが
    // [1, 2, 5, 6] で、クエリが <= 3 の場合である。その場合は、スライスの
    // 開始位置を決めるために探索（二分探索を使う）を行う必要がある。

    // 注: gte の場合、この時点で valueDesc 配列はリストになっていなければならない
    const values = filterCache.meta.valuesDesc as Array<FilterValue>
    // targetValue は見つからないはずだが（見つかることもある）、targetValue を
    // 挟む 2 つの値のインデックス、または最初か最後の要素を返す。
    const point = binarySearchDesc(values, filterValue)
    if (!point) {
      return undefined
    }
    const [pivotMin, pivotMax] = point

    // 各ピボットのインデックスには値と範囲がなければならない
    // 返される min/max のインデックスは下限や上限を含むことがあるので、
    // 両方の値に対して gte のチェックが必要である。
    let pivotValue = values[pivotMax]
    if (pivotValue < filterValue) {
      pivotValue = values[pivotMin]
    }

    // 注: ピボットの値はフィルターの値と一致 _しないはず_ である。一致するなら
    // 値が実際に見つかったことになるが、そうした値はインデックス化されているので、
    // 上の .get() で結果が得られていたはずである。

    const [exclPivot, inclPivot] = ranges!.get(pivotValue) as [number, number]

    // 注: 厳密には `5 >= "5" === true` だが、`5` はキャッシュされない。
    // そのため、緩い比較を考慮する必要があり、ピボットを含めなければならないことがある
    const until = pivotValue >= filterValue ? inclPivot : exclPivot
    const arr = nodes!.slice(0, until).reverse()
    arr.sort(sortByIds)
    // elemMatch によって 1 つのノードが複数のバケットに現れることがあるので、重複を取り除く必要がある
    if (wasElemMatch) {
      expensiveDedupeInline(arr)
    }
    return arr
  }

  // FilterOp（op の型）のすべての値を確認済みなので、到達しない
  return undefined
}

function removeBucketFromSet(
  filterValue: FilterValueNullable,
  filterCache: IFilterCache,
  set: Set<IGatsbyNodePartial>
): void {
  if (filterValue === null) {
    // エッジケース: `null` を指定した $ne は、完全なパスを持ち、かつ null に
    // 解決されないノードだけを返す。そのため `undefined` も取り除く。
    let cache = filterCache.byValue.get(undefined)
    if (cache) cache.forEach(node => set.delete(node))
    cache = filterCache.byValue.get(null)
    if (cache) cache.forEach(node => set.delete(node))
  } else {
    // null を除外していないので、undefined の末端や、何らかの理由で
    // パスが部分的にしか存在しない末端も含めるべきである。
    const cache = filterCache.byValue.get(filterValue)
    if (cache) cache.forEach(node => set.delete(node))
  }
}

/**
 * 2 つの配列の積集合を O(n) で求める。n = min(a.length, b.length)
 * 返される集合は重複するノードを含まないはずである。
 *
 * 入力は node.internal.counter の順に並んでいる必要があり、返される一覧も
 * node.internal.counter の順に並ぶ
 */
export function intersectNodesByCounter(
  a: Array<IGatsbyNodePartial>,
  b: Array<IGatsbyNodePartial>
): Array<IGatsbyNodePartial> {
  let pointerA = 0
  let pointerB = 0
  // TODO: パフォーマンスの確認: 配列を min(maxA,maxB) 個の要素で初期化すると効果があるか
  const result: Array<IGatsbyNodePartial> = []
  const maxA = a.length
  const maxB = b.length
  let lastAdded: IGatsbyNodePartial | undefined = undefined // 一覧の重複を取り除くために使う

  while (pointerA < maxA && pointerB < maxB) {
    const counterA = a[pointerA].internal.counter
    const counterB = b[pointerB].internal.counter

    if (counterA < counterB) {
      pointerA++
    } else if (counterA > counterB) {
      pointerB++
    } else {
      if (a[pointerA].id !== b[pointerB].id) {
        throw new Error(
          `Invariant violation: inconsistent node counters detected`
        )
      }
      // nodeA===nodeB。このノードを直前に追加していないことを確認する。
      // 入力の配列はソートされているので、同じノードは連続して並ぶはずである。
      // そのため、両方の入力配列が同じノードを 2 回含んでいても、
      // このチェックによって結果に重複するノードが入ることを防げる
      if (lastAdded !== a[pointerA]) {
        result.push(a[pointerA])
        lastAdded = a[pointerA]
      }
      pointerA++
      pointerB++
    }
  }

  return result
}

/**
 * ノードの 2 つの一覧をマージする。
 * 返される集合は重複するノードを含まないはずである。
 *
 * 入力は node.internal.counter の順に並んでいる必要があり、返される一覧も
 * node.internal.counter の順に並ぶ
 */
export function unionNodesByCounter(
  a: Array<IGatsbyNodePartial>,
  b: Array<IGatsbyNodePartial>
): Array<IGatsbyNodePartial> {
  // TODO: パフォーマンスの確認: 配列を max(maxA,maxB) 個の要素で初期化すると効果があるか
  const arr: Array<IGatsbyNodePartial> = []
  let lastAdded: IGatsbyNodePartial | undefined = undefined // 一覧の重複を取り除くために使う

  let pointerA = 0
  let pointerB = 0
  const maxA = a.length
  const maxB = b.length

  while (pointerA < maxA && pointerB < maxB) {
    const counterA = a[pointerA].internal.counter
    const counterB = b[pointerB].internal.counter

    if (counterA < counterB) {
      if (lastAdded !== a[pointerA]) {
        arr.push(a[pointerA])
        lastAdded = a[pointerA]
      }
      pointerA++
    } else if (counterA > counterB) {
      if (lastAdded !== b[pointerB]) {
        arr.push(b[pointerB])
        lastAdded = b[pointerB]
      }
      pointerB++
    } else {
      if (lastAdded !== a[pointerA]) {
        arr.push(a[pointerA])
        lastAdded = a[pointerA]
      }
      pointerA++
      pointerB++
    }
  }

  while (pointerA < maxA) {
    if (lastAdded !== a[pointerA]) {
      arr.push(a[pointerA])
      lastAdded = a[pointerA]
    }
    pointerA++
  }

  while (pointerB < maxB) {
    if (lastAdded !== b[pointerB]) {
      arr.push(b[pointerB])
      lastAdded = b[pointerB]
    }
    pointerB++
  }

  return arr
}

function expensiveDedupeInline(arr: Array<IGatsbyNodePartial>): void {
  // elemMatch フィルターによって、バケットに重複が現れることがある。
  // バケットはソートされているので、重複は連続して並んでいるはずである
  // 最悪の場合でも、これは何もしない高速な O(n) のループである。
  let prev: IGatsbyNodePartial | undefined = undefined

  // splice はコストが高く、Set も使えないので、重複を見つけた時点でコピーする

  let j = 0
  for (let i = 0; i < arr.length; ++i) {
    const node = arr[i]
    if (node !== prev) {
      // 重複が見つかってから初めて、一覧の残りのコピーを開始する
      if (i !== j) {
        arr[j] = node
      }
      ++j
      prev = node
    }
  }
  arr.length = j
}

export function getSortFieldIdentifierKeys(
  indexFields: Array<string>,
  resolvedFields: Record<string, any>
): Array<string> {
  const dottedFields = objectToDottedField(resolvedFields)
  const dottedFieldKeys = Object.keys(dottedFields)
  const fieldKeys = indexFields.map(field => {
    if (
      dottedFields[field] ||
      dottedFieldKeys.some(key => field.startsWith(key))
    ) {
      return `__gatsby_resolved.${field}`
    } else {
      return field
    }
  })

  return fieldKeys
}
