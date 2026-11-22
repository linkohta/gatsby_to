import repl from "repl"
import { graphql } from "graphql"
import { bootstrap } from "../bootstrap"
import { getNodes, getNode, getNodesByType } from "../datastore"
import { loadNodeContent } from "../utils/nodes"
import { store } from "../redux"
import { IProgram } from "./types"

module.exports = async (program: IProgram): Promise<void> => {
  // ブートストラップを実行する
  await bootstrap({ program })

  // store から必要なものをすべて取得する
  const { schema, config, babelrc, pages, components, staticQueryComponents } =
    store.getState()

  const nodes = getNodes()

  const query = async (query: string): Promise<void> => {
    const result = await graphql({
      schema,
      source: query,
      rootValue: {},
      contextValue: {},
    })
    console.log(`query result: ${JSON.stringify(result)}`)
  }

  // 新しい REPL を初期化する
  const _ = repl.start({
    prompt: `gatsby > `,
  })

  // 作業を楽にするために、いくつかグローバルを設定する
  _.context.babelrc = babelrc
  _.context.components = components
  _.context.getNode = getNode
  _.context.getNodes = getNodes
  _.context.getNodesByType = getNodesByType
  _.context.loadNodeContent = loadNodeContent
  _.context.nodes = [...nodes.entries()]
  _.context.pages = [...pages.entries()]
  _.context.graphql = query
  _.context.schema = schema
  _.context.siteConfig = config
  _.context.staticQueries = staticQueryComponents

  _.on(`exit`, () => {
    process.exit(0)
  })
}
