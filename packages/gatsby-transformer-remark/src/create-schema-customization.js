const typeDefs = `
  type MarkdownHeading {
    id: String
    value: String
    depth: Int
  }

  enum MarkdownHeadingLevels {
    h1
    h2
    h3
    h4
    h5
    h6
  }

  enum MarkdownExcerptFormats {
    PLAIN
    HTML
    MARKDOWN
  }

  type MarkdownWordCount {
    paragraphs: Int
    sentences: Int
    words: Int
  }

  type MarkdownRemark implements Node @infer @childOf(mimeTypes: ["text/markdown", "text/x-markdown"]) {
    id: ID!
  }
`

module.exports = (nodeApiArgs, pluginOptions = {}) => {
  const { plugins = [] } = pluginOptions

  nodeApiArgs.actions.createTypes(typeDefs)

  // これにより、サブプラグインは `gatsby-transformer-remark` にバインドされた Node API を使って
  // GraphQL スキーマをカスタマイズできる。その結果、サブプラグインが
  // `gatsby-transformer-remark` の所有する型を変更できるようになる。
  plugins.forEach(plugin => {
    const resolvedPlugin = plugin.module

    if (typeof resolvedPlugin.createSchemaCustomization === `function`) {
      resolvedPlugin.createSchemaCustomization(
        nodeApiArgs,
        plugin.pluginOptions
      )
    }
  })
}

module.exports.typeDefs = typeDefs
