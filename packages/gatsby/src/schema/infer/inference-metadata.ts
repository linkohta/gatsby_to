/* eslint-disable @typescript-eslint/no-use-before-define */
/*
## メタデータを使ってノードの構造をインクリメンタルに追跡する

このメタデータは、後で（`exampleValue` の構築を通じて、または直接）
スキーマの推論に利用できる

### 使用例:

```javascript
  const node1 = { id: '1', foo: 25, bar: 'str' }
  const node2 = { id: '1', foo: 'conflict' }

  let meta = { ignoredFields: new Set(['id']) }
  meta = addNode(meta, node1)
  meta = addNode(meta, node2)
  console.log(meta.fieldMap)
  // outputs: {
  //   foo: {
  //     int: { total: 1, example: 25 },
  //     string: { total: 1, example: 'conflict' },
  //   },
  //   bar: {
  //     string: { total: 1, example: 'str' },
  //   },
  // }

  const example1 = getExampleObject({ meta, typeName, typeConflictReporter })
  console.log(example1)
  // outputs { bar: 'str' }
  // and reports conflicts discovered

  meta = deleteNode(meta, node2)
  console.log(meta.fieldMap)
  // outputs: {
  //   foo: {
  //     int: { total: 1, example: 25 },
  //     string: { total: 0, example: 'conflict' },
  //   },
  //   bar: { string: { total: 1, example: 'str' } },
  // }

  const example2 = getExampleObject({ meta, typeName, typeConflictReporter })
  // outputs: { foo: 25, bar: 'str' }
```

`addNode`、`deleteNode`、`getExampleObject` は O(N) である。N はノードオブジェクトの
フィールドの数（ネストしたフィールドを含む）

### 注意点

* 配列の衝突の追跡は難しい。たとえば { a: [5, "foo"] } と、{ a: [5] }, { a: ["foo"] } は、
  メタデータでは同じように表される。これを回避するために、最初の NodeId も追跡する:
  { a: { array: { item: { int: { total: 1, first: `1` }, string: { total: 1, first: `1` } }}
  { a: { array: { item: { int: { total: 1, first: `1` }, string: { total: 1, first: `2` } }}
  これにより、より役に立つ衝突のレポートを出せる
  （それでも、ノードが削除された場合など、レポートが分かりにくくなるまれなエッジケースはありうる）
*/

import { isEqual } from "lodash"
import { is32BitInteger } from "../../utils/is-32-bit-integer"
import { looksLikeADate } from "../types/date"
import { Node } from "../../../index"
import { TypeConflictReporter } from "./type-conflict-reporter"

export interface ITypeInfo {
  first?: string
  total: number
  example?: unknown
}

export interface ITypeInfoString extends ITypeInfo {
  empty: number
  example: string
}

export interface ITypeInfoDate extends ITypeInfo {
  example: string | Date
}

export interface ITypeInfoNumber extends ITypeInfo {
  example: number
}

export interface ITypeInfoBoolean extends ITypeInfo {
  example: boolean
}

export interface ITypeInfoArray extends ITypeInfo {
  item: IValueDescriptor
}

export interface ITypeInfoRelatedNodes extends ITypeInfo {
  nodes: { [key: string]: number }
}

export interface ITypeInfoObject extends ITypeInfo {
  dprops: {
    [name: string]: IValueDescriptor
  }
}

export interface IValueDescriptor {
  int?: ITypeInfoNumber
  float?: ITypeInfoNumber
  date?: ITypeInfoDate
  string?: ITypeInfoString
  boolean?: ITypeInfoBoolean
  array?: ITypeInfoArray
  relatedNode?: ITypeInfoRelatedNodes
  relatedNodeList?: ITypeInfoRelatedNodes
  object?: ITypeInfoObject
}

export type ValueType = keyof IValueDescriptor

export interface ITypeMetadata {
  typeName?: string
  disabled?: boolean
  ignored?: boolean
  dirty?: boolean
  total?: number
  ignoredFields?: Set<string>
  fieldMap?: Record<string, IValueDescriptor>
  typeConflictReporter?: TypeConflictReporter
  [key: string]: unknown
}

type Operation = "add" | "del"

const getType = (value: unknown, key: string): ValueType | "null" => {
  // できるだけ GraphQL の型に近づけている
  switch (typeof value) {
    case `number`:
      return is32BitInteger(value) ? `int` : `float`
    case `string`:
      if (key.includes(`___NODE`)) {
        return `relatedNode`
      }
      return looksLikeADate(value) ? `date` : `string`
    case `boolean`:
      return `boolean`
    case `object`:
      if (value === null) return `null`
      if (value instanceof Date) return `date`
      if (value instanceof String) return `string`
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `null`
        }
        return key.includes(`___NODE`) ? `relatedNodeList` : `array`
      }
      if (!Object.keys(value).length) return `null`
      return `object`
    default:
      // bigint、symbol、function、unknown（たとえば IE のホストオブジェクトは typeof が "unknown" だった）
      return `null`
  }
}

const updateValueDescriptorObject = (
  value: Record<string, unknown>,
  typeInfo: ITypeInfoObject,
  nodeId: string,
  operation: Operation,
  metadata: ITypeMetadata,
  path: Array<Record<string, unknown>>
): void => {
  path.push(value)

  const { dprops = {} } = typeInfo
  typeInfo.dprops = dprops

  Object.keys(value).forEach(key => {
    const v = value[key]

    let descriptor = dprops[key]
    if (descriptor === undefined) {
      descriptor = {}
      dprops[key] = descriptor
    }

    updateValueDescriptor(nodeId, key, v, operation, descriptor, metadata, path)
  })

  path.pop()
}

const updateValueDescriptorArray = (
  value: Array<unknown>,
  key: string,
  typeInfo: ITypeInfoArray,
  nodeId: string,
  operation: Operation,
  metadata: ITypeMetadata,
  path: Array<Record<string, unknown>>
): void => {
  value.forEach(item => {
    let descriptor = typeInfo.item
    if (descriptor === undefined) {
      descriptor = {}
      typeInfo.item = descriptor
    }

    updateValueDescriptor(
      nodeId,
      key,
      item,
      operation,
      descriptor,
      metadata,
      path
    )
  })
}

const updateValueDescriptorRelNodes = (
  listOfNodeIds: Array<string>,
  delta: number,
  operation: Operation,
  typeInfo: ITypeInfoRelatedNodes,
  metadata: ITypeMetadata
): void => {
  const { nodes = {} } = typeInfo
  typeInfo.nodes = nodes

  listOfNodeIds.forEach(nodeId => {
    nodes[nodeId] = (nodes[nodeId] || 0) + delta

    // 関連する新しいノードの追加や削除は、すべて構造の変更として扱う
    // FIXME: これは誤検知を生む。このノードは、すでにマップにある別のノードと
    //  同じ型かもしれないためである（ただし、ここではそれが分からない）
    if (nodes[nodeId] === 0 || (operation === `add` && nodes[nodeId] === 1)) {
      metadata.dirty = true
    }
  })
}

const updateValueDescriptorString = (
  value: string,
  delta: number,
  typeInfo: ITypeInfoString
): void => {
  if (value === ``) {
    const { empty = 0 } = typeInfo
    typeInfo.empty = empty + delta
  }
  typeInfo.example =
    typeof typeInfo.example !== `undefined` ? typeInfo.example : value
}

const updateValueDescriptor = (
  nodeId: string,
  key: string,
  value: unknown,
  operation: Operation = `add`,
  descriptor: IValueDescriptor,
  metadata: ITypeMetadata,
  path: Array<Record<string, unknown>>
): void => {
  // オブジェクトは、ルートから複数回走査されることがある。
  // そのたびに、同じノードを 2 回訪れないようにすべきである
  if (path.includes(value as Record<string, unknown>)) {
    return
  }

  const typeName = getType(value, key)

  if (typeName === `null`) {
    return
  }

  const delta = operation === `del` ? -1 : 1

  let typeInfo: ITypeInfo | undefined = descriptor[typeName]
  if (typeInfo === undefined) {
    // eslint-disable-next-line no-undef
    typeInfo = (descriptor[typeName] as ITypeInfo) = { total: 0 }
  }
  typeInfo.total += delta

  // 構造の変更を追跡する
  // （新しい型の値が追加されたとき、または既存の型に値が 1 つも割り当てられなくなったとき）
  if (typeInfo.total === 0 || (operation === `add` && typeInfo.total === 1)) {
    metadata.dirty = true
  }

  // この型の最初のノードを追跡する。衝突のレポートを分かりやすくするためだけに使う。
  // （冒頭のコメントの 「注意点」の節を参照）
  if (operation === `add`) {
    if (!typeInfo.first) {
      typeInfo.first = nodeId
    }
  } else if (operation === `del`) {
    if (typeInfo.first === nodeId || typeInfo.total === 0) {
      typeInfo.first = undefined
    }
  }

  switch (typeName) {
    case `object`:
      updateValueDescriptorObject(
        value as Record<string, unknown>,
        typeInfo as ITypeInfoObject,
        nodeId,
        operation,
        metadata,
        path
      )
      return
    case `array`:
      updateValueDescriptorArray(
        value as Array<unknown>,
        key,
        typeInfo as ITypeInfoArray,
        nodeId,
        operation,
        metadata,
        path
      )
      return
    case `relatedNode`:
      updateValueDescriptorRelNodes(
        [value as string],
        delta,
        operation,
        typeInfo as ITypeInfoRelatedNodes,
        metadata
      )
      return
    case `relatedNodeList`:
      updateValueDescriptorRelNodes(
        value as Array<string>,
        delta,
        operation,
        typeInfo as ITypeInfoRelatedNodes,
        metadata
      )
      return
    case `string`:
      updateValueDescriptorString(
        value as string,
        delta,
        typeInfo as ITypeInfoString
      )
      return
  }

  // int, float, boolean, null

  typeInfo.example =
    typeof typeInfo.example !== `undefined` ? typeInfo.example : value
}

const mergeObjectKeys = (
  dpropsKeysA: Record<string, unknown> = {},
  dpropsKeysB: Record<string, unknown> = {}
): Array<string> => {
  const dprops = Object.keys(dpropsKeysA)
  const otherProps = Object.keys(dpropsKeysB)
  return [...new Set(dprops.concat(otherProps))]
}

const descriptorsAreEqual = (
  descriptor?: IValueDescriptor,
  otherDescriptor?: IValueDescriptor
): boolean => {
  const types = possibleTypes(descriptor)
  const otherTypes = possibleTypes(otherDescriptor)

  const childDescriptorsAreEqual = (type: string): boolean => {
    switch (type) {
      case `array`:
        return descriptorsAreEqual(
          descriptor?.array?.item,
          otherDescriptor?.array?.item
        )
      case `object`: {
        const dpropsKeys = mergeObjectKeys(
          descriptor?.object?.dprops,
          otherDescriptor?.object?.dprops
        )
        return dpropsKeys.every(prop =>
          descriptorsAreEqual(
            descriptor?.object?.dprops[prop],
            otherDescriptor?.object?.dprops[prop]
          )
        )
      }
      case `relatedNode`: {
        const nodeIds = mergeObjectKeys(
          descriptor?.relatedNode?.nodes,
          otherDescriptor?.relatedNode?.nodes
        )
        // 等しいと見なすには、両方の記述子に存在するか、
        // 両方に存在しないかでなければならない
        return nodeIds.every(
          id =>
            Boolean(descriptor?.relatedNode?.nodes[id]) ===
            Boolean(otherDescriptor?.relatedNode?.nodes[id])
        )
      }
      case `relatedNodeList`: {
        const nodeIds = mergeObjectKeys(
          descriptor?.relatedNodeList?.nodes,
          otherDescriptor?.relatedNodeList?.nodes
        )
        return nodeIds.every(
          id =>
            Boolean(descriptor?.relatedNodeList?.nodes[id]) ===
            Boolean(otherDescriptor?.relatedNodeList?.nodes[id])
        )
      }
      default:
        return true
    }
  }

  // 取りうるすべての型が等しい場合（衝突を含む）に、等しいとする
  return isEqual(types, otherTypes) && types.every(childDescriptorsAreEqual)
}

const nodeFields = (node: Node, ignoredFields = new Set()): Array<string> =>
  Object.keys(node).filter(key => !ignoredFields.has(key))

const updateTypeMetadata = (
  metadata = initialMetadata(),
  operation: Operation,
  node: Node
): ITypeMetadata => {
  if (metadata.disabled) {
    return metadata
  }
  metadata.total = (metadata.total || 0) + (operation === `add` ? 1 : -1)
  if (metadata.ignored) {
    return metadata
  }
  const { ignoredFields, fieldMap = {} } = metadata

  nodeFields(node, ignoredFields).forEach(field => {
    let descriptor = fieldMap[field]
    if (descriptor === undefined) {
      descriptor = {}
      fieldMap[field] = descriptor
    }

    updateValueDescriptor(
      node.id,
      field,
      node[field],
      operation,
      descriptor,
      metadata,
      []
    )
  })
  metadata.fieldMap = fieldMap
  return metadata
}

const ignore = (metadata = initialMetadata(), set = true): ITypeMetadata => {
  metadata.ignored = set
  metadata.fieldMap = {}
  return metadata
}

const disable = (metadata = initialMetadata(), set = true): ITypeMetadata => {
  metadata.disabled = set
  return metadata
}

const addNode = (metadata: ITypeMetadata, node: Node): ITypeMetadata =>
  updateTypeMetadata(metadata, `add`, node)

const deleteNode = (metadata: ITypeMetadata, node: Node): ITypeMetadata =>
  updateTypeMetadata(metadata, `del`, node)

const addNodes = (
  metadata = initialMetadata(),
  nodes: Iterable<Node>
): ITypeMetadata => {
  let state = metadata
  for (const node of nodes) {
    state = addNode(state, node)
  }
  return state
}

const possibleTypes = (descriptor: IValueDescriptor = {}): Array<ValueType> =>
  Object.keys(descriptor).filter(
    type => descriptor[type].total > 0
  ) as Array<ValueType>

const isEmpty = ({ fieldMap }): boolean =>
  Object.keys(fieldMap).every(
    field => possibleTypes(fieldMap[field]).length === 0
  )

// 空の型であっても、ノードを持っていることがある
const hasNodes = (typeMetadata: ITypeMetadata): boolean =>
  (typeMetadata.total ?? 0) > 0

const haveEqualFields = (
  { fieldMap = {} } = {},
  { fieldMap: otherFieldMap = {} } = {}
): boolean => {
  const fields = mergeObjectKeys(fieldMap, otherFieldMap)
  return fields.every(field =>
    descriptorsAreEqual(fieldMap[field], otherFieldMap[field])
  )
}

const initialMetadata = (state?: Record<string, unknown>): ITypeMetadata => {
  return {
    typeName: undefined,
    disabled: false,
    ignored: false,
    dirty: false,
    total: 0,
    ignoredFields: undefined,
    fieldMap: {},
    ...state,
  }
}

export {
  addNode,
  addNodes,
  deleteNode,
  ignore,
  disable,
  isEmpty,
  hasNodes,
  haveEqualFields,
  initialMetadata,
}
