/**
 * @typedef {import('@babel/core').PluginObject} PluginObject
 * @typedef {import('@babel/core').types} BabelTypes
 */

/**
 * 式を含まないテンプレートリテラルで書かれた `import()` の指定子を、文字列リテラルに置き換える。
 *
 * このリポジトリでは文字列をバッククォートで書くので、動的 import も `import(\`foo\`)` になる。
 * @babel/plugin-transform-modules-commonjs は、指定子が文字列リテラルのときだけ
 * `require("foo")` という静的な形に変換し、それ以外は実行時に指定子を評価する
 * `require(s)` に変換する。後者は webpack などが解析できず、エンジンのバンドルに
 * 依存先が含まれなくなるので、変換の前に文字列リテラルにしておく。
 *
 * @param {{ types: BabelTypes }} babel
 * @returns {PluginObject}
 */
module.exports = function staticImportSpecifier({ types: t }) {
  return {
    name: `babel-transform-static-import-specifier`,
    visitor: {
      // ほかのプラグインが import() を変換する前に置き換えるため、Program に入った時点で処理する
      Program(programPath) {
        programPath.traverse({
          ImportExpression(path) {
            const { source } = path.node

            if (t.isTemplateLiteral(source) && source.expressions.length === 0) {
              // webpack のマジックコメントは指定子の前に書かれるので、コメントを引き継ぐ
              path.node.source = t.inheritsComments(
                t.stringLiteral(source.quasis[0].value.cooked),
                source
              )
            }
          },
        })
      },
    },
  }
}
