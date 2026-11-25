import { declare } from "@babel/helper-plugin-utils"
import * as t from "@babel/types"
import type { PluginObject, PluginPass, ConfigAPI, NodePath } from "@babel/core"
import { removeExportProperties } from "./babel-module-exports-helpers"

interface IRemoveApiState extends PluginPass {
  apiRemoved?: boolean
}

/**
 * 指定されたモジュールの export をファイルから取り除く。
 */
export default declare(function removeApiCalls(
  api: ConfigAPI,
  options: { apis?: Array<string> }
): PluginObject<IRemoveApiState> {
  api.assertVersion(8)

  const apisToRemove = options?.apis ?? []

  if (!apisToRemove.length) {
    console.warn(
      `No list of APIs was given to remove, check your plugin options.`
    )
  }

  return {
    name: `remove-api`,
    visitor: {
      Program: {
        exit(path, state): void {
          if (!state.apiRemoved) {
            return
          }

          // babel は参照をあまりうまく取り除けないので、何も取り除かれなくなるまでループする
          let removed = false

          // 参照されていないバインディングをすべて取り除く
          do {
            removed = false
            // すべての参照が最新になっているようにする
            path.scope.crawl()

            Object.keys(path.scope.bindings).forEach(refName => {
              const ref = path.scope.bindings[refName]

              if (ref.referenced) {
                // 関数は自分自身を参照できるので、関数スコープの外に
                // バインディングがあるかどうかを確認する必要がある。
                if (ref.path.type === `FunctionDeclaration`) {
                  const isSelfReferenced = ref.referencePaths.every(
                    refPath => !!refPath.findParent(p => p === ref.path)
                  )

                  if (isSelfReferenced) {
                    ref.path.remove()
                    removed = true
                  }
                }
              } else {
                // const {x,y} が使われている場合は、プロパティを取り除く
                if (
                  t.isVariableDeclarator(ref.path.node) &&
                  t.isObjectPattern(
                    (ref.path.parent as t.VariableDeclaration).declarations[0]
                      .id
                  )
                ) {
                  const objectPattern = (
                    ref.path.parent as t.VariableDeclaration
                  ).declarations[0].id as t.ObjectPattern
                  objectPattern.properties = objectPattern.properties.filter(
                    prop =>
                      t.isObjectProperty(prop)
                        ? (prop.value as t.Identifier).name !== refName
                        : ((prop as t.RestElement).argument as t.Identifier)
                            .name !== refName
                  )

                  // すべてのプロパティが取り除かれてオブジェクトパターンが空になった場合は、宣言全体を取り除く
                  if (!objectPattern.properties.length) {
                    ref.path.remove()
                  }
                } else {
                  ref.path.remove()
                }

                // モジュールであり、すべての specifier が取り除かれた場合は、バインディング全体を取り除く
                if (
                  ref.kind === `module` &&
                  !(ref.path.parent as t.ImportDeclaration).specifiers.length &&
                  ref.path.parentPath
                ) {
                  ref.path.parentPath.remove()
                }

                removed = true
              }
            })
          } while (removed)
        },
      },

      // export 文を取り除く

      ExportDefaultDeclaration(path, state): void {
        if (apisToRemove.includes(`default`)) {
          state.apiRemoved = true
          path.remove()
        }
      },
      ExportNamedDeclaration(path, state): void {
        const declaration = path.node.declaration

        if (t.isExportNamedDeclaration(path.node)) {
          const specifiersToKeep: Array<
            | t.ExportDefaultSpecifier
            | t.ExportNamespaceSpecifier
            | t.ExportSpecifier
          > = []

          // `export { foo } = [...]` と `export { foo } from "X"` の形の export を取り除く
          path.node.specifiers.forEach(specifier => {
            if (
              t.isExportSpecifier(specifier) &&
              t.isIdentifier(specifier.exported) &&
              apisToRemove.includes(specifier.exported.name)
            ) {
              // Babel 8 の AST では、`export { "a b" as foo } from "X"` のように
              // local が文字列リテラルになることがある
              const localName = t.isIdentifier(specifier.local)
                ? specifier.local.name
                : specifier.local.value
              const binding = path.scope.bindings[localName]
              // `export { foo } from "X"` の場合は、バインディングが存在しない
              if (binding) {
                binding.path.remove()
              }
            } else {
              specifiersToKeep.push(specifier)
            }
          })

          path.node.specifiers = specifiersToKeep
        }

        // `export function foo() {}` の形の export を取り除く
        let apiToCheck
        if (t.isFunctionDeclaration(declaration) && declaration.id) {
          apiToCheck = declaration.id.name
        }

        // `export const foo = () => {}` の形の export を取り除く
        if (
          t.isVariableDeclaration(declaration) &&
          t.isIdentifier(declaration.declarations[0].id)
        ) {
          apiToCheck = declaration.declarations[0].id.name
        }

        if (apiToCheck && apisToRemove.includes(apiToCheck)) {
          state.apiRemoved = true
          path.remove()
        }

        // `export const { foo } = () => {}` の形の export を取り除く
        if (t.isVariableDeclaration(declaration)) {
          for (let i = 0; i < declaration?.declarations.length; i++) {
            if (declaration?.declarations[i].id.type === `ObjectPattern`) {
              const objectPath = path.get(
                `declaration.declarations.${i}.id`
              ) as NodePath<t.ObjectPattern>
              removeExportProperties(path, objectPath, apisToRemove)
            }
          }
        }
        // `export const { foo } from "X"` の形の export を取り除く
        else if (path.node?.source) {
          if (path.node.specifiers.length === 0) {
            path.remove()
          }
        }
      },

      // `module.exports = { foo }` と `exports.foo = {}` の形の export を取り除く
      ExpressionStatement(path, state): void {
        if (
          !t.isAssignmentExpression(path.node.expression) ||
          !t.isMemberExpression(path.node.expression.left) ||
          (path.node.expression.left.object as t.Identifier).name !== `exports`
        ) {
          return
        }

        const apiToCheck = (path.node.expression.left.property as t.Identifier)
          .name
        if (apiToCheck && apisToRemove.includes(apiToCheck)) {
          state.apiRemoved = true
          path.remove()
        }
      },
    },
  }
})
