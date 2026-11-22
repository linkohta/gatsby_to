import { ExportNamedDeclaration, ObjectPattern } from "@babel/types"
import { NodePath } from "@babel/core"

/**
 * ノードに兄弟が少なくとも 1 つあることを確認する。
 */
export function hasSibling(path: NodePath): boolean {
  return (
    [...path.getAllPrevSiblings(), ...path.getAllNextSiblings()].length !== 0
  )
}

/**
 * 分割代入された変数の名前付き export から、特定のプロパティを取り除く。
 *
 * 他にプロパティも宣言もなければ、export 宣言全体を取り除く。
 * 他にプロパティがあれば、一致するプロパティだけを取り除く。
 *
 * 次のような export に一致する:
 * ```
 * export const { foo } = {} // or `let`/`var`
 * export const { foo, bar: baz } = {} // or `let`/`var`
 * ```
 *
 * これは、ネストしたビジターを使い、上へたどって export 宣言からの距離を
 * 確認するよりもコストが低い。
 */
export function removeExportProperties(
  exportPath: NodePath<ExportNamedDeclaration>,
  objectPath: NodePath<ObjectPattern>,
  propertiesToRemove: Array<string>
): void {
  for (let i = 0; i < objectPath.node.properties.length; i++) {
    const property = objectPath.node.properties[i]

    if (
      property.type !== `ObjectProperty` ||
      property.value.type !== `Identifier` ||
      !propertiesToRemove.includes(property.value.name)
    ) {
      continue
    }

    const propertyPath = objectPath.get(`properties.${i}`) as NodePath

    if (hasSibling(propertyPath) && !propertyPath.removed) {
      propertyPath.remove()
      continue
    }

    if (hasSibling(objectPath.parentPath) && !objectPath.parentPath.removed) {
      objectPath.parentPath.remove()
      break
    }

    if (!exportPath.removed) {
      exportPath.remove()
    }
  }
}
