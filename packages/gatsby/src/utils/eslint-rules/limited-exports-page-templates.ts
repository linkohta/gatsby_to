import { Rule } from "eslint"
import {
  Node,
  Identifier,
  ImportDeclaration,
  TaggedTemplateExpression,
  VariableDeclaration,
  CallExpression,
  Literal,
  TemplateLiteral,
  VariableDeclarator,
  ObjectPattern,
  AssignmentProperty,
  ExportNamedDeclaration,
} from "estree"
import { store } from "../../redux"
import { isPageTemplate } from "../eslint-rules-helpers"

const DEFAULT_GRAPHQL_TAG_NAME = `graphql`

function isApiExport(node: ExportNamedDeclaration, name: string): boolean {
  // 次の形を確認する
  // export function name() {}
  // export async function name() {}
  if (
    node.declaration?.type === `FunctionDeclaration` &&
    node.declaration.id?.name === name
  ) {
    return true
  }

  // 次の形を確認する
  // export const name = () => {}
  if (node.declaration?.type === `VariableDeclaration`) {
    for (const declaration of node.declaration.declarations) {
      if (
        declaration.type === `VariableDeclarator` &&
        declaration.id.type === `Identifier` &&
        declaration.id.name === name
      ) {
        return true
      }
    }
  }

  if (name === `Head`) {
    // Head は再 export されることも、クラスコンポーネントであることもあるので、上の確認だけでは不十分であり、
    // ここではもっと緩くする必要がある

    // クラスコンポーネント
    if (
      node.declaration?.type === `ClassDeclaration` &&
      node.declaration?.id?.type === `Identifier` &&
      node.declaration?.id?.name === name
    ) {
      return true
    }

    // 再 export
    if (
      node.source &&
      node.specifiers.some(
        specifier => (specifier.exported as Identifier).name === name
      )
    ) {
      return true
    }
  }

  return false
}

function hasOneValidNamedDeclaration(
  node: Node,
  varName: string | undefined
): boolean {
  // 次の形を確認する:
  // const query = graphql``
  // export { query }
  if (node.type === `ExportNamedDeclaration` && node.declaration === null) {
    // export { foobar, query } の場合、declaration は null で、specifiers が存在する
    // { foobar, query } では true を返し、{ query } では false を返す
    // { default } の宣言は許可されているので、すべて無視する
    const nonQueryExports = node.specifiers.some(e =>
      varName
        ? (e.exported as Identifier).name !== varName &&
          (e.exported as Identifier).name !== `default`
        : (e.exported as Identifier).name !== `default`
    )
    return !nonQueryExports
  }

  return false
}

function isTemplateQuery(
  node: Node,
  graphqlTagName: string,
  namespaceSpecifierName: string
): boolean {
  // export const query = 'foobar' の場合、型が 'VariableDeclaration' の declaration が存在する

  // 次の形を確認する:
  // export const query = graphql``
  // この場合、declarations 配列の項目は 1 つだけである
  // export const hello = 10, world = 'foo' の場合、
  // 配列の項目は 2 つになる。そのため every() を使って、TaggedTemplateExpression で
  // 名前が "graphql" の項目が 1 つだけ存在するかを確認する

  // さらに、declaration は、import * as Gatsby from "gatsby" で import された場合の
  // Gatsby.graphql`` のような MemberExpression であることもある

  return (
    node.type === `ExportNamedDeclaration` &&
    node.declaration?.type === `VariableDeclaration` &&
    node.declaration?.declarations.every(el => {
      if (
        el?.init?.type === `TaggedTemplateExpression` &&
        el.init.tag.type === `Identifier`
      ) {
        return el.init.tag.name === graphqlTagName
      } else if (
        el?.init?.type === `TaggedTemplateExpression` &&
        el.init.tag.type === `MemberExpression`
      ) {
        return (
          (el.init.tag.object as Identifier).name === namespaceSpecifierName &&
          (el.init.tag.property as Identifier).name === DEFAULT_GRAPHQL_TAG_NAME
        )
      }
      return false
    })
  )
}

const limitedExports: Rule.RuleModule = {
  meta: {
    type: `problem`,
    messages: {
      limitedExportsPageTemplates: `In page templates only a default export of a valid React component and the named exports of a page query, getServerData, Head or config are allowed.
        All other named exports will cause Fast Refresh to not preserve local component state and do a full refresh.

        Please move your other named exports to another file. Also make sure that you only export page queries that use the "graphql" tag from "gatsby".
`,
    },
  },
  create: context => {
    if (!isPageTemplate(store, context)) {
      return {}
    }

    let queryVariableName: string | undefined = ``
    let graphqlTagName = ``
    let namespaceSpecifierName = ``

    return {
      // const { graphql } = require('gatsby')
      VariableDeclaration: (node): void => {
        // require('gatsby') であるかを確認する
        const requiredFromGatsby = (
          node as VariableDeclaration
        ).declarations.find(el => {
          // require(`gatsby`) を処理する
          if (
            (el.init as CallExpression)?.arguments?.[0]?.type ===
            `TemplateLiteral`
          ) {
            return (
              ((el.init as CallExpression).arguments[0] as TemplateLiteral)
                ?.quasis[0].value.raw === `gatsby`
            )
          }

          return (
            ((el.init as CallExpression)?.arguments?.[0] as Literal)?.value ===
            `gatsby`
          )
        })

        if (requiredFromGatsby) {
          // const { graphql, Link } = require('gatsby') の中の "graphql" を探す
          const graphqlTagSpecifier = (
            (requiredFromGatsby as VariableDeclarator).id as ObjectPattern
          )?.properties.find(
            el =>
              ((el as AssignmentProperty).key as Identifier).name ===
              DEFAULT_GRAPHQL_TAG_NAME
          )

          if (graphqlTagSpecifier) {
            graphqlTagName = (
              (graphqlTagSpecifier as AssignmentProperty).value as Identifier
            ).name
          }
        }

        return undefined
      },
      // import { graphql } from "gatsby"
      ImportDeclaration: (node): void => {
        // specifier が "gatsby" から import されていることを確認する
        if ((node as ImportDeclaration).source.value === `gatsby`) {
          const graphqlTagSpecifier = (
            node as ImportDeclaration
          ).specifiers.find(el => {
            // 対象にしたいのは import { graphql } from "gatsby" だけであり、
            // import graphql from "gatsby" ではない
            if (el.type === `ImportSpecifier`) {
              // 元の名前が "graphql" の specifier だけを取得する
              return (
                (el.imported as Identifier).name === DEFAULT_GRAPHQL_TAG_NAME
              )
            }
            // import * as Gatsby from "gatsby"
            if (el.type === `ImportNamespaceSpecifier`) {
              namespaceSpecifierName = el.local.name
              return false
            }
            return false
          })
          if (graphqlTagSpecifier) {
            // local.name は、import { graphql as otherName } の場合を扱う
            // 通常の import { graphql } では、imported の名前と local の名前は同じである
            graphqlTagName = graphqlTagSpecifier.local.name
          }
        }
        return undefined
      },
      TaggedTemplateExpression: (node): void => {
        if (
          (node as TaggedTemplateExpression).type ===
            `TaggedTemplateExpression` &&
          ((node as TaggedTemplateExpression).tag as Identifier)?.name ===
            graphqlTagName
        ) {
          if (queryVariableName) {
            return undefined
          }
          // @ts-ignore
          queryVariableName = node.parent?.id?.name
        }

        return undefined
      },
      ExportNamedDeclaration: (node): void => {
        if (hasOneValidNamedDeclaration(node, queryVariableName)) {
          return undefined
        }

        if (isTemplateQuery(node, graphqlTagName, namespaceSpecifierName)) {
          return undefined
        }

        if (isApiExport(node, `getServerData`)) {
          return undefined
        }

        if (isApiExport(node, `config`)) {
          return undefined
        }

        if (isApiExport(node, `Head`)) {
          return undefined
        }

        context.report({
          node,
          messageId: `limitedExportsPageTemplates`,
        })

        return undefined
      },
    }
  },
}

module.exports = limitedExports
