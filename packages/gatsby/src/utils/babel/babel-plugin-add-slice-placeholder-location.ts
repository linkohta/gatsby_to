import { relative } from "path"
import type { PluginObj, types as BabelTypes, PluginPass } from "@babel/core"
import { ObjectProperty } from "@babel/types"
import { store } from "../../redux"

/**
 * これは、Slice のプレースホルダーコンポーネントを見つけて、プレースホルダーが見つかった
 * ファイル名とファイル内の位置を持つ __renderedByLocation prop を注入するプラグインである。これは後で、
 * ユーザーの props が無効なときに、より役に立つエラーメッセージを出すために使われる。ユーザーにとって役に立たない
 * Slice コンポーネント自体（gatsby の内部）のコードフレームではなく、ユーザーがレンダリングしようとした箇所のコードフレームを表示する。
 */

export default function addSlicePlaceholderLocation(
  this: PluginPass,
  {
    types: t,
  }: {
    types: typeof BabelTypes
  }
): PluginObj {
  return {
    name: `babel-plugin-add-slice-placeholder-location`,
    visitor: {
      JSXOpeningElement(nodePath): void {
        if (!nodePath.get(`name`).referencesImport(`gatsby`, `Slice`)) {
          return
        }

        if (this.file.opts.filename) {
          const __renderedByLocationProperties: Array<ObjectProperty> = [
            t.objectProperty(
              t.identifier(`fileName`),
              t.stringLiteral(
                relative(
                  store.getState().program.directory,
                  this.file.opts.filename
                )
              )
            ),
          ]

          if (nodePath.node.loc?.start.line) {
            __renderedByLocationProperties.push(
              t.objectProperty(
                t.identifier(`lineNumber`),
                t.numericLiteral(nodePath.node.loc.start.line)
              )
            )

            if (nodePath.node.loc?.start.column) {
              __renderedByLocationProperties.push(
                t.objectProperty(
                  t.identifier(`columnNumber`),
                  t.numericLiteral(nodePath.node.loc.start.column + 1)
                )
              )
            }

            if (nodePath.node.loc?.end.line) {
              __renderedByLocationProperties.push(
                t.objectProperty(
                  t.identifier(`endLineNumber`),
                  t.numericLiteral(nodePath.node.loc.end.line)
                )
              )

              if (nodePath.node.loc?.end.column) {
                __renderedByLocationProperties.push(
                  t.objectProperty(
                    t.identifier(`endColumnNumber`),
                    t.numericLiteral(nodePath.node.loc.end.column + 1)
                  )
                )
              }
            }
          }

          const newProp = t.jsxAttribute(
            t.jsxIdentifier(`__renderedByLocation`),
            t.jsxExpressionContainer(
              t.objectExpression(__renderedByLocationProperties)
            )
          )

          nodePath.node.attributes.push(newProp)
        }
      },
    },
  }
}
