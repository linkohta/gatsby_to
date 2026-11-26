// asciidoctor 4 は ESM のみで、モジュール自体が API を持つ（ファクトリー関数ではない）
const asciidoc = require(`asciidoctor`)
const _ = require(`lodash`)

function shouldOnCreateNode({ node }, pluginOptions = {}) {
  const extensionsConfig = pluginOptions.fileExtensions

  // 拡張子を設定可能にし、デフォルトでは adoc と asciidoc を使う
  const supportedExtensions =
    extensionsConfig instanceof Array ? extensionsConfig : [`adoc`, `asciidoc`]

  return supportedExtensions.includes(node.extension)
}

async function onCreateNode(
  {
    node,
    actions,
    pathPrefix,
    loadNodeContent,
    createNodeId,
    reporter,
    createContentDigest,
  },
  pluginOptions
) {
  // カスタムのコンバーターが指定されていれば登録する
  if (pluginOptions.converterFactory) {
    asciidoc.ConverterFactory.register(
      new pluginOptions.converterFactory(asciidoc),
      [`html5`]
    )
  }

  // 渡されたオプションを複製し、imagesdir 属性（未指定の場合は `/images@`）の先頭に pathPrefix を付ける
  const asciidocOptions = processPluginOptions(pluginOptions, pathPrefix)

  const { createNode, createParentChildLink } = actions
  // Asciidoc の内容を読み込む
  const content = await loadNodeContent(node)
  // 抽出のために Asciidoc ファイルを読み込む
  // https://asciidoctor-docs.netlify.app/asciidoctor.js/processor/extract-api/
  // ここで `let` を使っているのは注意喚起のためである。.convert() などの一部の操作は document を変更する
  const doc = await asciidoc.load(content, {
    base_dir: node.dir,
    ...asciidocOptions,
  })

  try {
    // asciidoctor 4 では変換が非同期になった
    const html = await doc.convert()
    // title、subtitle、combined を取得できるよう、"partition" オプションを使う
    const title = doc.getDocumentTitle({ partition: true })

    let revision = null

    if (doc.hasRevisionInfo()) {
      revision = {
        date: doc.getRevisionDate(),
        number: doc.getRevisionNumber(),
        remark: doc.getRevisionRemark(),
      }
    }

    // asciidoctor 2 の getAuthor() は著者がいない文書でも Opal の nil（真になるオブジェクト）を返していたため、
    // author は常に作られていた。asciidoctor 4 では undefined になるが、author が null になると
    // `author.fullName` などを読むサイトが壊れるので、これまでどおり常に作る
    const author = {
      fullName: doc.getAttribute(`author`),
      firstName: doc.getAttribute(`firstname`),
      lastName: doc.getAttribute(`lastname`) || ``,
      middleName: doc.getAttribute(`middlename`) || ``,
      authorInitials: doc.getAttribute(`authorinitials`) || ``,
      email: doc.getAttribute(`email`) || ``,
    }

    const pageAttributes = extractPageAttributes(doc.getAttributes())

    const asciiNode = {
      id: createNodeId(`${node.id} >>> ASCIIDOC`),
      parent: node.id,
      internal: {
        type: `Asciidoc`,
        mediaType: `text/html`,
      },
      children: [],
      html,
      document: {
        title: title?.getCombined() ?? ``,
        subtitle: title?.hasSubtitle() ? title.getSubtitle() : ``,
        main: title?.getMain() ?? ``,
      },
      revision,
      author,
      pageAttributes,
    }

    asciiNode.internal.contentDigest = createContentDigest(asciiNode)

    createNode(asciiNode)
    createParentChildLink({ parent: node, child: asciiNode })
  } catch (err) {
    reporter.panicOnBuild(
      `Error processing Asciidoc ${
        node.absolutePath ? `file ${node.absolutePath}` : `in node ${node.id}`
      }:\n
      ${err.message}`
    )
  }
}

const processPluginOptions = _.memoize((pluginOptions, pathPrefix) => {
  const defaultImagesDir = `/images@`
  const currentPathPrefix = pathPrefix || ``

  const clonedPluginOptions = _.cloneDeep(pluginOptions)

  if (clonedPluginOptions.attributes === undefined) {
    clonedPluginOptions.attributes = {}
  }

  clonedPluginOptions.attributes.imagesdir = withPathPrefix(
    currentPathPrefix,
    clonedPluginOptions.attributes.imagesdir || defaultImagesDir
  )

  return clonedPluginOptions
})

const withPathPrefix = (pathPrefix, url) =>
  (pathPrefix + url).replace(/\/\//, `/`)

const extractPageAttributes = allAttributes =>
  Object.entries(allAttributes).reduce((pageAttributes, [key, value]) => {
    if (key.startsWith(`page-`)) {
      pageAttributes[key.replace(/^page-/, ``)] = value
    }
    return pageAttributes
  }, {})

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
