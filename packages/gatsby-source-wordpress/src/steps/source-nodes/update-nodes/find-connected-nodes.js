import flattenDeep from "lodash/flattenDeep"
import { dump } from "dumper.js"

// スキーマの構築中にすべてのノードが作成された後で、ノードタイプ間に成り立ち得るリレーションシップを保存する。たとえば WpPost 型を構築するとき、WpPost のフィールドでつながり得るノードタイプとして見つかった gatsby のノードごとに、WpPost => [...ConnectedTypeNames] の形で redux に記録する。

// Page を差分で作成または更新するときは、つながっているノードの id をすべて見つけ、それぞれの id の型を確認する。つながっている id の型のいずれかが、現在のノードタイプをつながり得るノードタイプとして持ち、かつこのノードがそのノードとつながっていない場合は、新しくつながった可能性があるので、そのノードを取得し直すべきである。

// たとえば新しい Page を作成し、つながっているノードの id を確認して、その 1 つが User 型だと判定したとする。User 型は、つながり得るノードとして Page を持つ。そこで、このノードがそのノードとつながっているかを確認する。つながっていなければ、その User ノードが、つながっているノードとしてこのノードを取りこぼしていないとは言い切れない。そのため、Page につながっているノードである User を取得し直す。逆方向のリレーションシップが見つからない、すべてのつながっているノードについて、これを行う。

const recursivelySearchForIds = ([key, value]) => {
  if (!key || !value) {
    return null
  }

  if (key === `id`) {
    return value
  } else if (typeof value === `string` || typeof value === `number`) {
    return null
  }

  if (Array.isArray(value)) {
    dump(key)
    // 配列の各値を順に処理する。オブジェクトであれば、そのフィールドを再帰的に処理する
    // それ以外であればスキップする。
    value.map(innerValue => {
      if (innerValue === null) {
        return null
      }

      if (key === `id` && typeof innerValue === `string`) {
        return innerValue
      }

      if (typeof innerValue === `object`) {
        return Object.values(innerValue).map(recursivelySearchForIds)
      }

      return null
    })
  } else if (typeof value === `object`) {
    dump(key)
    return Object.entries(value).map(recursivelySearchForIds)
  }

  return null
}

export const findConnectedNodeIds = node => {
  const childNodeIds = [
    ...new Set(
      flattenDeep(Object.entries(node).map(recursivelySearchForIds)).filter(
        id => id !== node.id && !!id
      )
    ),
  ]

  if (!childNodeIds.length) {
    return null
  }

  return childNodeIds
}
