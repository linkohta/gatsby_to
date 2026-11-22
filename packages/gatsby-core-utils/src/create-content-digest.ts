import crypto, { BinaryLike } from "crypto"
import objectHash from "node-object-hash"

const hasher = objectHash({
  coerce: false,
  alg: `md5`,
  enc: `hex`,
  sort: {
    map: true,
    object: true,
    array: false,
    set: false,
  },
})

const hashPrimitive = (input: BinaryLike | string): string =>
  crypto.createHash(`md5`).update(input).digest(`hex`)

/**
 * 入力を md5 でハッシュ化し、16 進数のダイジェストにする。
 *
 * @param input ハッシュ化する入力
 * @return コンテンツダイジェスト
 */

export const createContentDigest = (
  input: BinaryLike | string | any
): string => {
  if (typeof input === `object` && !Buffer.isBuffer(input)) {
    return hasher.hash(input)
  }

  return hashPrimitive(input)
}
