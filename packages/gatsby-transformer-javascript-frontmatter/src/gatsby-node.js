const _ = require(`lodash`)
const babylon = require(`@babel/parser`)
const traverse = require(`@babel/traverse`).default

const fileExtsToProcess = [`js`, `jsx`, `ts`, `tsx`]

function shouldOnCreateNode({ node }) {
  // JavaScript と TypeScript のファイルだけを処理する。
  return fileExtsToProcess.includes(node.extension)
}

async function onCreateNode({
  node,
  actions,
  loadNodeContent,
  createContentDigest,
}) {
  const { createNode, createParentChildLink } = actions

  const code = await loadNodeContent(node)
  const options = {
    sourceType: `module`,
    allowImportExportEverywhere: true,
    // Babel 8 のパーサーは、仕様に入った構文（クラスフィールド、動的 import など）を
    // 常に解釈するので、ここにはまだ提案段階の構文と JSX だけを並べている
    plugins: [
      `jsx`,
      `doExpressions`,
      `decorators`,
      `functionBind`,
      `functionSent`,
      _.includes([`ts`, `tsx`], node.extension) ? `typescript` : `flow`,
    ],
  }

  let exportsData
  let frontmatter
  let error
  try {
    let ast
    try {
      ast = babylon.parse(code, options)
    } catch (jsxError) {
      // Babel 8 のパーサーは、JSX が有効だと `<T>(value: T) => value` のような型引数付きの
      // アロー関数を解釈できない（Babel 7 は解釈できた）。`.ts` では、JSX を無効にして解釈し直す
      if (node.extension !== `ts`) {
        throw jsxError
      }
      ast = babylon.parse(code, {
        ...options,
        plugins: options.plugins.filter(plugin => plugin !== `jsx`),
      })
    }

    const parseData = function parseData(node) {
      let value

      if (node.type === `TemplateLiteral`) {
        // テンプレートリテラルへの実験的で基本的な対応:
        // テキストの内容を取り出して連結し、補間は無視する
        value = node.quasis.map(quasi => quasi.value.cooked).join(``)
      } else if (node.type === `ObjectExpression`) {
        value = {}
        node.properties.forEach(elem => {
          value[elem.key.name] = parseData(elem.value)
        })
      } else if (node.type === `ArrayExpression`) {
        value = node.elements.map(elem => parseData(elem))
      } else {
        value = node.value
      }

      return value
    }

    frontmatter = {}
    error = false
    traverse(ast, {
      AssignmentExpression: function AssignmentExpression(astPath) {
        if (
          astPath.node.left.type === `MemberExpression` &&
          astPath.node.left.property.name === `frontmatter`
        ) {
          astPath.node.right.properties.forEach(node => {
            frontmatter[node.key.name] = parseData(node.value)
          })
        }
      },
      ExportNamedDeclaration: function ExportNamedDeclaration(astPath) {
        const { declaration } = astPath.node
        if (declaration && declaration.type === `VariableDeclaration`) {
          const dataVariableDeclarator = _.find(
            declaration.declarations,
            d => d.id.name === `frontmatter`
          )

          if (dataVariableDeclarator && dataVariableDeclarator.init) {
            dataVariableDeclarator.init.properties.forEach(node => {
              frontmatter[node.key.name] = parseData(node.value)
            })
          }
        }
      },
    })
  } catch (e) {
    // ユーザーが適切と考える方法でエラーに対処できるよう、
    // エラーをクエリに付ける
    error = {
      err: true,
      code: e.code,
      message: e.message,
      stack: e.stack,
    }
  } finally {
    // frontmatter が空でない場合にだけノードを作成する
    if (!_.isEmpty(frontmatter)) {
      exportsData = {
        ...frontmatter,
        error: error,
      }

      const contentDigest = createContentDigest(node)
      const nodeData = {
        id: `${node.id} >>> JavascriptFrontmatter`,
        children: [],
        parent: node.id,
        node: { ...node },
        internal: {
          contentDigest,
          type: `JavascriptFrontmatter`,
        },
      }

      nodeData.frontmatter = { ...exportsData }

      if (node.internal.type === `File`) {
        nodeData.fileAbsolutePath = node.absolutePath
      }

      createNode(nodeData)
      createParentChildLink({ parent: node, child: nodeData })
    }
  }
}

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
