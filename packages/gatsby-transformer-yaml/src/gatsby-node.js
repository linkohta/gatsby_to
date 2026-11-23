const jsYaml = require(`js-yaml`)
const _ = require(`lodash`)
const path = require(`path`)

// js-yaml 5 の既定のスキーマは YAML 1.2 のコアスキーマで、日付（timestamp）や
// `<<` によるマージなどを解釈しない。js-yaml 4 までと同じ読み取り結果になるよう、
// それらのタグを加えたスキーマを使う。
const yamlSchema = jsYaml.CORE_SCHEMA.withTags([
  jsYaml.timestampTag,
  jsYaml.mergeTag,
  jsYaml.binaryTag,
  jsYaml.omapTag,
  jsYaml.pairsTag,
  jsYaml.setTag,
])

function parseYaml(content) {
  // js-yaml 5 の `load` は、空の入力（コメントだけの入力を含む）でエラーを投げる。
  // js-yaml 4 までは何も返さず、ノードを作らないだけだったので、その動作を保つ。
  const documents = jsYaml.loadAll(content, { schema: yamlSchema })
  if (documents.length === 0) {
    return undefined
  }

  // 複数のドキュメントを含む入力は、これまでどおり `load` のエラーにする。
  return documents.length === 1
    ? documents[0]
    : jsYaml.load(content, { schema: yamlSchema })
}

function shouldOnCreateNode({ node }) {
  return node.internal.mediaType === `text/yaml`
}

async function onCreateNode(
  { node, actions, loadNodeContent, createNodeId, createContentDigest },
  pluginOptions
) {
  function getType({ node, object, isArray }) {
    if (pluginOptions && _.isFunction(pluginOptions.typeName)) {
      return pluginOptions.typeName({ node, object, isArray })
    } else if (pluginOptions && _.isString(pluginOptions.typeName)) {
      return pluginOptions.typeName
    } else if (node.internal.type !== `File`) {
      return _.upperFirst(_.camelCase(`${node.internal.type} Yaml`))
    } else if (isArray) {
      return _.upperFirst(_.camelCase(`${node.name} Yaml`))
    } else {
      return _.upperFirst(_.camelCase(`${path.basename(node.dir)} Yaml`))
    }
  }

  function transformObject(obj, id, type) {
    const yamlNode = {
      ...obj,
      id,
      children: [],
      parent: node.id,
      internal: {
        contentDigest: createContentDigest(obj),
        type,
      },
    }
    if (obj.id) {
      yamlNode[`yamlId`] = obj.id
    }
    createNode(yamlNode)
    createParentChildLink({ parent: node, child: yamlNode })
  }

  const { createNode, createParentChildLink } = actions

  const content = await loadNodeContent(node)
  const parsedContent = parseYaml(content)

  if (_.isArray(parsedContent)) {
    parsedContent.forEach((obj, i) => {
      transformObject(
        obj,
        createNodeId(`${node.id} [${i}] >>> YAML`),
        getType({ node, object: obj, isArray: true })
      )
    })
  } else if (_.isPlainObject(parsedContent)) {
    transformObject(
      parsedContent,
      createNodeId(`${node.id} >>> YAML`),
      getType({ node, object: parsedContent, isArray: false })
    )
  }
}

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
