import fs from "fs-extra"
import { getStore } from "~/store"
import prettier from "prettier"
import { formatLogMessage } from "~/utils/format-log-message"

export const writeQueriesToDisk = async ({ reporter }, pluginOptions) => {
  if (!pluginOptions?.debug?.graphql?.writeQueriesToDisk) {
    return
  }

  const { remoteSchema } = getStore().getState()

  // クエリが変わるのは、リモートスキーマが変わったときだけである
  // 変わっていなければ、ディスクに書き出す必要はない
  if (!remoteSchema.schemaWasChanged) {
    return
  }

  const activity = reporter.activityTimer(
    formatLogMessage(`writing GraphQL queries to disk at ./WordPress/GraphQL/`)
  )

  activity.start()
  const wordPressGraphQLDirectory = `${process.cwd()}/WordPress/GraphQL`

  // 古い型が残っている場合に備え、書き出す前に削除する
  fs.rmSync(wordPressGraphQLDirectory, {
    recursive: true,
    force: true,
  })

  for (const {
    nodeListQueries,
    nodeQuery,
    previewQuery,
    typeInfo,
  } of Object.values(remoteSchema.nodeQueries)) {
    const directory = `${wordPressGraphQLDirectory}/${typeInfo.nodesTypeName}`

    await fs.ensureDir(directory)

    await fs.writeFile(
      `${directory}/node-list-query.graphql`,
      prettier.format(nodeListQueries[0], { parser: `graphql` }),
      `utf8`
    )

    await fs.writeFile(
      `${directory}/node-single-query.graphql`,
      prettier.format(nodeQuery, { parser: `graphql` }),
      `utf8`
    )

    await fs.writeFile(
      `${directory}/node-preview-query.graphql`,
      prettier.format(previewQuery, { parser: `graphql` }),
      `utf8`
    )
  }

  const directory = `${wordPressGraphQLDirectory}/RootQuery`

  await fs.ensureDir(directory)

  await fs.writeFile(
    `${directory}/non-node-root-query.graphql`,
    prettier.format(remoteSchema.nonNodeQuery, { parser: `graphql` })
  )

  activity.end()
}
