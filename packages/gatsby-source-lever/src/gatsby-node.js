const fetch = require(`./fetch`)
const normalize = require(`./normalize`)

const typePrefix = `lever__`

exports.createSchemaCustomization = async ({ actions }) => {
  const typeDefs = `
    type lever implements Node {
      additional: String
      additionalPlain: String
      applyUrl: String
      createdAt: Date @dateformat
      description: String
      descriptionPlain: String
      hostedUrl: String
      lever_id: String
      text: String
      categories: leverCategories
      lists: [leverList]
    }

    type leverCategories {
      commitment: String
      level: String
      location:String
      team: String
    }

    type leverList {
      content: String
      text: String
    }
  `
  actions.createTypes(typeDefs)
}

exports.sourceNodes = async (
  { actions, getNode, store, cache, createNodeId, createContentDigest },
  { site, verboseOutput }
) => {
  const { createNode } = actions

  let entities = await fetch({
    site,
    verboseOutput,
    typePrefix,
  })

  // データを正規化し、ノードを作成する
  //
  // エンティティのオブジェクトのコレクションからエンティティを作成する
  entities = normalize.normalizeEntities(entities)

  // id を標準化し、キーを整理する
  entities = normalize.standardizeKeys(entities)

  // GMT の日付だけを使うように変換する
  entities = normalize.standardizeDates(entities)

  // 各エンティティの Gatsby ID を作成する
  entities = normalize.createGatsbyIds(createNodeId, entities)

  // 各エントリーのノードを作成する
  normalize.createNodesFromEntities({
    entities,
    createNode,
    createContentDigest,
  })

  return
}
