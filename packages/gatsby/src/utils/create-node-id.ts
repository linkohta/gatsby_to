import { v5 as uuidv5 } from "uuid"
import report from "gatsby-cli/lib/reporter"

const seedConstant = `638f7a53-c567-4eca-8fc1-b23efb1cfb2b`

// このキャッシュは、uuid の重複した呼び出しを防ぐ。特定のケースで効果がある
const unprefixedCache: Map<string, string> = new Map()
// ns -> name -> uuid
const namespacedCache: Map<string, Map<string, string>> = new Map([
  [``, unprefixedCache],
])

/**
 * 一貫性があり、決定的で、高速に生成でき、かつ予測可能な短さのハッシュになる一意な ID を生成する。
 *
 * この ID の特性:
 *
 * - `id` の値は何も意味を持つべきではない（これは「こちら側のもの」である）
 * - 値を暗号化する必要はない
 * - 値はシステムの中で一意でなければならない（小さな ascii の入力で、衝突のリスクができるだけ小さいこと）
 * - 値は決定的でなければならない（同じ入力からは常に同じ出力になる）
 * - 変換は高速でなければならない
 * - 結果は url で使われることがあるので、予測可能な短さであるべきである
 *
 * 大まかに言うと、このステップは、利用者がサイトの中でこの `id` に意味を持たせて使うのを防ぐことと、
 * 入力のサイズにかかわらず ID が短くなるようにすることを目的としている。
 *
 * 注: UUID は、SHA-1 ハッシュを生成するためにネイティブの crypto ライブラリを呼ぶので、比較的遅い。
 *       SHA-1 の衝突率の低さは必要なので、繰り返しの呼び出しを速くするためにローカルの（グローバルな）キャッシュを使う
 *
 * @param {String | Number} id - 任意の長さの文字列
 * @param {String} namespace - UUID に使う名前空間
 *
 * @return {String} - UUID
 */
export function createNodeId(id: string | number, namespace: string): string {
  if (typeof id === `number`) {
    id = id.toString()
  } else if (typeof id !== `string`) {
    report.panic(
      `The \`id\` parameter passed to createNodeId must be a String or Number (got ${typeof id})`
    )
  } else if (typeof namespace !== `string`) {
    report.panic(
      `The \`namespace\` parameter passed to createNodeId must be a String (got ${typeof namespace})`
    )
  }

  let nsHash = unprefixedCache.get(namespace)
  if (!nsHash) {
    nsHash = uuidv5(namespace, seedConstant) as string
    unprefixedCache.set(namespace, nsHash)
  }

  // uuid の呼び出しは、sha1 のために crypto を呼ぶので比較的コストが高い。
  // 同じ ns+id の組での呼び出しをローカルのマップでキャッシュしており、これが大きく効く。
  let nsCache = namespacedCache.get(namespace)
  if (!nsCache) {
    nsCache = new Map()
    namespacedCache.set(namespace, nsCache)
  }

  let hash = nsCache.get(id)
  if (hash) {
    return hash
  }

  hash = uuidv5(id, nsHash) as string
  nsCache.set(id, hash)
  return hash
}
