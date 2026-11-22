const toml = require(`toml`)
const _ = require(`lodash`)

function shouldOnCreateNode({ node }) {
  // toml 以外の内容を取り除く
  // 現在、TOML ファイルは 'mime-db' で null と見なされる
  // そのため、mediaType ではなく拡張子で判定している
  return node.extension === `toml`
}

async function onCreateNode({
  node,
  actions,
  loadNodeContent,
  createNodeId,
  createContentDigest,
}) {
  const { createNode, createParentChildLink } = actions

  // TOML の内容を読み込む
  const content = await loadNodeContent(node)
  // パースする
  const parsedContent = toml.parse(content)

  // このバージョンには次の問題がある:
  // 1) TOML ファイルが増えるほど型が増える
  // 2) 同じ名前の異なるファイルが衝突する
  const contentDigest = createContentDigest(parsedContent)

  const newNode = {
    ...parsedContent,
    id: parsedContent.id
      ? parsedContent.id
      : createNodeId(`${node.id} >>> TOML`),
    children: [],
    parent: node.id,
    internal: {
      contentDigest,

      // 相対ファイルパスを "type" として使う
      type: _.upperFirst(_.camelCase(node.relativePath)),
    },
  }

  createNode(newNode)
  createParentChildLink({ parent: node, child: newNode })
  return
}

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
