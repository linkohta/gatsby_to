const csv = require(`csvtojson`)
const _ = require(`lodash`)

const { typeNameFromFile } = require(`./index`)

const convertToJson = (data, options) =>
  csv(options)
    .fromString(data)
    .then(jsonData => jsonData, new Error(`CSV to JSON conversion failed!`))

function shouldOnCreateNode({ node }, pluginOptions = {}) {
  const { extension } = node
  const { extensions } = pluginOptions

  return extensions ? extensions.includes(extension) : extension === `csv`
}

async function onCreateNode(
  { node, actions, loadNodeContent, createNodeId, createContentDigest },
  pluginOptions
) {
  const { createNode, createParentChildLink } = actions

  // 独自のオプションを分割代入で取り出す
  const { typeName, nodePerFile, ...options } = pluginOptions || {}

  // ファイルの内容を読み込む
  const content = await loadNodeContent(node)

  // パースする
  const parsedContent = await convertToJson(content, options)

  // 型を生成する
  function getType({ node, object }) {
    if (pluginOptions && _.isFunction(typeName)) {
      return pluginOptions.typeName({ node, object })
    } else if (pluginOptions && _.isString(typeName)) {
      return _.upperFirst(_.camelCase(typeName))
    } else {
      return typeNameFromFile({ node })
    }
  }

  // 新しいノードを生成する
  async function transformObject(obj, i) {
    const csvNode = {
      ...obj,
      id:
        obj.id ??
        createNodeId(`${node.id} [${i}] >>> ${node.extension.toUpperCase()}`),
      children: [],
      parent: node.id,
      internal: {
        contentDigest: createContentDigest(obj),
        // TODO: "type" の選び方をもっと賢くする。ここでは
        // 親ノードがファイルであると仮定している。
        // PascalCase
        type: getType({ node, object: parsedContent }),
      },
    }

    await createNode(csvNode)
    createParentChildLink({ parent: node, child: csvNode })
  }

  if (_.isArray(parsedContent)) {
    if (pluginOptions && nodePerFile) {
      if (pluginOptions && _.isString(nodePerFile)) {
        await transformObject({ [nodePerFile]: parsedContent }, 0)
      } else {
        await transformObject({ items: parsedContent }, 0)
      }
    } else {
      for (let i = 0, l = parsedContent.length; i < l; i++) {
        const obj = parsedContent[i]
        await transformObject(obj, i)
      }
    }
  }

  return
}

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
