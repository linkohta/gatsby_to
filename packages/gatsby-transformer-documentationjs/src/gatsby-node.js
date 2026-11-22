const documentation = require(`documentation`)
const remark = require(`remark`)
const _ = require(`lodash`)
const Prism = require(`prismjs`)

const stringifyMarkdownAST = (node = ``) => {
  if (_.isString(node)) {
    return node
  } else {
    return remark().stringify(node)
  }
}

const docId = (parentId, docsJson) => {
  const lineNumber = docsJson.loc
    ? docsJson.loc.start.line
    : docsJson.lineNumber

  return `documentationJS ${parentId} path #${JSON.stringify(
    docsJson.path
  )} line ${lineNumber}`
}

const descriptionId = (parentId, name) =>
  `${parentId}--DocumentationJSComponentDescription--${name}`

function prepareDescriptionNode(node, markdownStr, name, helpers) {
  const { createNodeId, createContentDigest } = helpers

  const descriptionNode = {
    id: createNodeId(descriptionId(node.id, name)),
    parent: node.id,
    children: [],
    internal: {
      type: `DocumentationJSComponentDescription`,
      mediaType: `text/markdown`,
      content: markdownStr,
      contentDigest: createContentDigest(markdownStr),
    },
  }

  return descriptionNode
}

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions
  const typeDefs = /* GraphQL */ `
    type DocumentationJs implements Node
      @childOf(types: ["File", "DocumentationJs"], many: true) {
      name: String
      kind: String
      memberof: String
      scope: String
      access: String
      optional: Boolean
      readonly: Boolean
      abstract: Boolean
      generator: Boolean
      async: Boolean
      override: Boolean
      hideconstructor: Boolean
      alias: String
      copyright: String
      author: String
      license: String
      since: String
      lends: String
      type: DoctrineType
      default: JSON
      description: DocumentationJSComponentDescription
        @link(from: "description___NODE")
      deprecated: DocumentationJSComponentDescription
        @link(from: "deprecated___NODE")
      augments: [DocumentationJs] @link(from: "augments___NODE")
      examples: [DocumentationJsExample]
      implements: [DocumentationJs] @link(from: "implements___NODE")
      params: [DocumentationJs] @link(from: "params___NODE")
      properties: [DocumentationJs] @link(from: "properties___NODE")
      returns: [DocumentationJs] @link(from: "returns___NODE")
      throws: [DocumentationJs] @link(from: "throws___NODE")
      todos: [DocumentationJs] @link(from: "todos___NODE")
      yields: [DocumentationJs] @link(from: "yields___NODE")
      members: DocumentationJsMembers
      codeLocation: DocumenationJSLocationRange
      docsLocation: DocumenationJSLocationRange
    }

    type DocumentationJSComponentDescription implements Node
      @mimeTypes(types: ["text/markdown"]) {
      id: ID! # empty type
    }

    type DocumentationJSLocation {
      line: Int
      column: Int
    }

    type DocumenationJSLocationRange {
      start: DocumentationJSLocation
      end: DocumentationJSLocation
    }

    type DocumentationJsExample {
      caption: String
      description: String
      highlighted: String
      raw: String
    }

    type DocumentationJsMembers {
      static: [DocumentationJs] @link(from: "static___NODE")
      instance: [DocumentationJs] @link(from: "instance___NODE")
      events: [DocumentationJs] @link(from: "events___NODE")
      global: [DocumentationJs] @link(from: "global___NODE")
      inner: [DocumentationJs] @link(from: "inner___NODE")
    }

    type DoctrineType {
      type: String
      name: String
      elements: [JSON]
      expression: JSON
      applications: [JSON]
      params: [JSON]
      fields: [JSON]
      result: JSON
      typeDef: DocumentationJs @link(from: "typeDef___NODE")
    }
  `
  createTypes(typeDefs)
}

exports.createResolvers = ({ createResolvers }) => {
  createResolvers({
    DocumentationJs: {
      type: {
        // `typeDef___NODE` を再帰的に解決する
        resolve: (source, _, context) => {
          if (!source.type) {
            return null
          }

          const fieldsToVisit = [`elements`, `expression`, `applications`]

          const resolve = obj => {
            if (!obj.typeDef___NODE) {
              return obj
            }

            return {
              ...obj,
              typeDef: context.nodeModel.getNodeById(
                { id: obj.typeDef___NODE, type: `DocumentationJs` },
                { path: context.path }
              ),
            }
          }

          const visit = obj => {
            if (!obj) {
              return null
            }

            const ret = { ...obj }

            fieldsToVisit.forEach(fieldName => {
              const v = obj[fieldName]
              if (!v) {
                return
              }

              if (Array.isArray(v)) {
                ret[fieldName] = v.map(t => visit(resolve(t)))
              } else {
                ret[fieldName] = visit(resolve(v))
              }
            })
            return ret
          }

          return visit(resolve(source.type))
        },
      },
    },
  })
}

function shouldOnCreateNode({ node }) {
  return (
    node.internal.type === `File` &&
    (node.internal.mediaType === `application/javascript` ||
      node.extension === `jsx` ||
      node.extension === `tsx` ||
      node.extension === `ts`)
  )
}

exports.shouldOnCreateNode = shouldOnCreateNode

/**
 * onCreateNode API を実装して、documentation.js のノードを作成する
 * @param {Object} super これは super パラメーターである
 */
exports.onCreateNode = async ({ node, actions, ...helpers }) => {
  const { createNodeId, createContentDigest } = helpers
  const { createNode, createParentChildLink } = actions

  let documentationJson
  try {
    documentationJson = await documentation.build(node.absolutePath, {
      shallow: true,
    })
  } catch (e) {
    // 無視する。おそらく他のツールがすでにエラーを確認しており、
    // ここでエラーにすると Gatsby が止まってしまうためである。
  }

  if (documentationJson && documentationJson.length > 0) {
    const handledDocs = new WeakMap()
    const typeDefs = new Map()

    const getNodeIDForType = (typeName, parent) => {
      if (typeDefs.has(typeName)) {
        return typeDefs.get(typeName)
      }

      const index = documentationJson.findIndex(
        docsJson =>
          docsJson.name === typeName &&
          [`interface`, `typedef`, `constant`].includes(docsJson.kind)
      )

      const isCycle = parent === documentationJson[index]
      if (isCycle) {
        helpers.reporter.warn(
          `Unexpected cycle detected creating DocumentationJS nodes for file:\n\n\t${node.absolutePath}\n\nFor type: ${typeName}`
        )
      }

      if (index !== -1 && !isCycle) {
        return prepareNodeForDocs(documentationJson[index], {
          commentNumber: index,
        }).node.id
      }

      return null
    }

    const tryToAddTypeDef = (type, parent) => {
      if (type.applications) {
        type.applications.forEach(t => tryToAddTypeDef(t, parent))
      }

      if (type.expression) {
        tryToAddTypeDef(type.expression, parent)
      }

      if (type.elements) {
        type.elements.forEach(t => tryToAddTypeDef(t, parent))
      }

      if (type.type === `NameExpression` && type.name) {
        type.typeDef___NODE = getNodeIDForType(type.name, parent)
      }
    }

    /**
     * JsDoc オブジェクトから Gatsby のノードを準備する。
     *  - description と deprecated のフィールドを markdown として設定する
     *  - params、properties、returns を再帰的に処理する
     *  - 型を型定義に関連付ける
     *  - 省略可能な型をアンラップして、トップレベルの optional フィールドにする
     * @param {Object} docsJson JsDoc オブジェクト。JsDoc オブジェクトの形の例は https://documentation.js.org/html-example/index.json を参照。
     * @param {Object} args
     * @param {Number} [args.commentNumber] モジュールのルートでの JsDoc のインデックス
     * @param {Number} args.level 入れ子のレベル
     * @param {string} args.parent 親ノードの id
     */
    const prepareNodeForDocs = (
      docsJson,
      { commentNumber = null, level = 0, parent = node.id } = {}
    ) => {
      if (handledDocs.has(docsJson)) {
        // これはすでに処理済みである
        return handledDocs.get(docsJson)
      }

      const docSkeletonNode = {
        commentNumber,
        level,
        id: createNodeId(docId(parent, docsJson)),
        parent,
        children: [],
        internal: {
          type: `DocumentationJs`,
        },
      }

      const children = []

      let picked = _.pick(docsJson, [
        `kind`,
        `memberof`,
        `name`,
        `scope`,
        `type`,
        `default`,
        `readonly`,
        `access`,
        `abstract`,
        `generator`,
        `async`,
        `override`,
        `hideconstructor`,
        `alias`,
        `copyright`,
        `author`,
        `license`,
        `since`,
        `lends`,
        `examples`,
        `tags`,
      ])

      picked.optional = false
      if (docsJson.loc) {
        // loc は SourceLocation クラスのインスタンスだが、Gatsby は現時点で、スキーマの推論時に
        // クラスのインスタンスに対応していない。シリアライズしてから
        // デシリアライズすることで、クラスのインスタンスをプレーンなオブジェクトに変換する。
        picked.docsLocation = JSON.parse(JSON.stringify(docsJson.loc))
      }
      if (docsJson.context && docsJson.context.loc) {
        picked.codeLocation = JSON.parse(JSON.stringify(docsJson.context.loc))
      }

      if (picked.type) {
        if (picked.type === `OptionalType` && docsJson.expression) {
          picked = { ...picked, optional: true, ...docsJson.expression }
        }
        if (picked.type.type === `OptionalType` && picked.type.expression) {
          picked.optional = true
          picked.type = picked.type.expression
        }

        tryToAddTypeDef(picked.type, docsJson)
      }

      const mdFields = [`description`, `deprecated`]

      mdFields.forEach(fieldName => {
        if (docsJson[fieldName]) {
          const childNode = prepareDescriptionNode(
            docSkeletonNode,
            stringifyMarkdownAST(docsJson[fieldName]),
            `comment.${fieldName}`,
            helpers
          )

          picked[`${fieldName}___NODE`] = childNode.id
          children.push({
            node: childNode,
          })
        }
      })

      const docsSubfields = [
        `augments`,
        `implements`,
        `params`,
        `properties`,
        `returns`,
        `throws`,
        `todos`,
        `yields`,
      ]
      docsSubfields.forEach(fieldName => {
        if (docsJson[fieldName] && docsJson[fieldName].length > 0) {
          picked[`${fieldName}___NODE`] = docsJson[fieldName].map(
            (docObj, fieldIndex) => {
              // 分割代入された引数をドキュメント化する場合、name は
              // parent.child になるが、必要なのは child だけである。
              if (docObj.name && docObj.name.split(`.`).length > 1) {
                docObj.name = docObj.name.split(`.`).slice(-1).join(`.`)
              }

              const adjustedObj = {
                ...docObj,
                path: [...docsJson.path, { fieldName, fieldIndex }],
              }

              const nodeHierarchy = prepareNodeForDocs(adjustedObj, {
                level: level + 1,
                parent: docSkeletonNode.id,
              })
              children.push(nodeHierarchy)
              return nodeHierarchy.node.id
            }
          )
        }
      })

      if (_.isPlainObject(docsJson.members)) {
        /*
        docsJson.members = {
          events: [],
          global: [],
          inner: [],
          instance: [],
          static: [],
        }
        メンバーの種類ごとに、トップレベルの jsdoc と同じ形の jsdoc の配列がある
        そのため、トップレベルのものと同じ変換を使う
        */
        picked.members = _.reduce(
          docsJson.members,
          (acc, membersOfType, key) => {
            if (membersOfType.length > 0) {
              acc[`${key}___NODE`] = membersOfType.map(member => {
                const nodeHierarchy = prepareNodeForDocs(member, {
                  level: level + 1,
                  parent: docSkeletonNode.id,
                })
                children.push(nodeHierarchy)
                return nodeHierarchy.node.id
              })
            }
            return acc
          },
          {}
        )
      }

      if (docsJson.examples) {
        picked.examples = docsJson.examples.map(example => {
          // <caption/> 要素から値を取り出す
          const caption =
            example?.caption?.children[0]?.children[0].value || null
          return {
            ...example,
            caption,
            raw: example.description,
            highlighted: Prism.highlight(
              example.description,
              Prism.languages.javascript
            ),
          }
        })
      }

      const docNode = {
        ...docSkeletonNode,
        ...picked,
      }
      docNode.internal.contentDigest = createContentDigest(docNode)

      if (docNode.kind === `typedef`) {
        typeDefs.set(docNode.name, docNode.id)
      }

      const nodeHierarchy = {
        node: docNode,
        children,
      }
      handledDocs.set(docsJson, nodeHierarchy)
      return nodeHierarchy
    }

    const rootNodes = documentationJson.map((docJson, index) =>
      prepareNodeForDocs(docJson, { commentNumber: index })
    )

    const createChildrenNodesRecursively = ({ node: parent, children }) => {
      if (children) {
        children.forEach(nodeHierarchy => {
          createNode(nodeHierarchy.node)
          createParentChildLink({
            parent,
            child: nodeHierarchy.node,
          })
          createChildrenNodesRecursively(nodeHierarchy)
        })
      }
    }

    createChildrenNodesRecursively({
      node,
      children: rootNodes,
    })

    return true
  } else {
    return null
  }
}
