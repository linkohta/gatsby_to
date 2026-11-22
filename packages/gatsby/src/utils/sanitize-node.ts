import _ from "lodash"

import type { IGatsbyNode } from "../redux/types"
import type { GatsbyIterable } from "../datastore/common/iterable"

type Data = IGatsbyNode | GatsbyIterable<IGatsbyNode>

type OmitUndefined = (data: Data) => Partial<Data>

/**
 * @param {Object|Array} data
 * @returns {Object|Array} undefined の値を取り除いたデータ
 */
const omitUndefined: OmitUndefined = data => {
  const isPlainObject = _.isPlainObject(data)
  if (isPlainObject) {
    return _.pickBy(data, p => p !== undefined)
  }

  return (data as GatsbyIterable<IGatsbyNode>).filter(p => p !== undefined)
}

type isTypeSupported = (data: Data) => boolean

/**
 * @param {*} data
 * @return {boolean} 型に対応しているかを表す真偽値
 */
const isTypeSupported: isTypeSupported = data => {
  if (data === null) {
    return true
  }

  const type = typeof data
  const isSupported =
    type === `number` ||
    type === `string` ||
    type === `boolean` ||
    data instanceof Date

  return isSupported
}

type sanitizeNode = (
  data: Data,
  isNode?: boolean,
  path?: Set<unknown>
) => Data | undefined

/**
 * データをシリアライズできるようにする
 * @param {(Object|Array)} data サニタイズするデータ
 * @param {boolean} isNode = true
 * @param {Set<string>} path = new Set
 */
export const sanitizeNode: sanitizeNode = (
  data,
  isNode = true,
  path = new Set()
) => {
  const isPlainObject = _.isPlainObject(data)
  const isArray = _.isArray(data)

  if (isPlainObject || isArray) {
    if (path.has(data)) return data
    path.add(data)

    const returnData = isPlainObject
      ? ({} as IGatsbyNode)
      : ([] as Array<IGatsbyNode>)
    let anyFieldChanged = false

    // _.each は "Collection" のメソッドなので、"length" プロパティを持つオブジェクトは配列として反復処理される
    const hasLengthProperty = isPlainObject
      ? Object.prototype.hasOwnProperty.call(data, `length`)
      : false
    let lengthProperty
    if (hasLengthProperty) {
      lengthProperty = (data as IGatsbyNode).length
      delete (data as IGatsbyNode).length
    }

    _.each(data, (value, key) => {
      if (isNode && key === `internal`) {
        returnData[key] = value
        return
      }
      returnData[key] = sanitizeNode(value as Data, false, path)

      if (returnData[key] !== value) {
        anyFieldChanged = true
      }
    })

    if (hasLengthProperty) {
      ;(data as IGatsbyNode).length = lengthProperty
      returnData.length = sanitizeNode(lengthProperty as Data, false, path)
      if (returnData.length !== lengthProperty) {
        anyFieldChanged = true
      }
    }

    if (anyFieldChanged) {
      data = omitUndefined(returnData as Data) as Data
    }

    // 配列とプレーンオブジェクトには対応しているので、サニタイズする必要はない
    return data
  }

  if (!isTypeSupported(data)) {
    return undefined
  } else {
    return data
  }
}
