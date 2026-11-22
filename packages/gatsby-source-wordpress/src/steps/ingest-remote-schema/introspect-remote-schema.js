import chalk from "chalk"
import * as diff from "diff"
import { uniqBy } from "lodash"
import { getStore } from "~/store"
import { setPersistentCache, getPersistentCache } from "~/utils/cache"
import fetchGraphql from "~/utils/fetch-graphql"
import { introspectionQuery } from "~/utils/graphql-queries"

/**
 * キャッシュしたイントロスペクションデータを取得するためのキャッシュキーを組み立てる
 */
const getCachedRemoteIntrospectionDataCacheKey = () => {
  const state = getStore().getState()
  const { pluginOptions } = state.gatsbyApi

  const INTROSPECTION_CACHE_KEY = `${pluginOptions.url}--introspection-data`

  return INTROSPECTION_CACHE_KEY
}

/**
 * リモートの WPGraphQL スキーマについて、キャッシュしたイントロスペクションデータを返す
 */
const getCachedRemoteIntrospectionData = async () => {
  const INTROSPECTION_CACHE_KEY = getCachedRemoteIntrospectionDataCacheKey()
  const introspectionData = await getPersistentCache({
    key: INTROSPECTION_CACHE_KEY,
  })

  return introspectionData
}

/**
 * WPGraphQL が、ある型のフィールドを公開しているかを確認する
 * たとえば `GatsbyPreviewData.manifestIds`
 * これにより、本来なら破壊的になる変更を、後方互換性を保って行える
 */
export const remoteSchemaSupportsFieldNameOnTypeName = async ({
  fieldName,
  typeName,
}) => {
  const introspectionData = await getCachedRemoteIntrospectionData()

  const type = introspectionData.__schema.types.find(
    ({ name }) => name === typeName
  )

  const fieldExists = !!type?.fields?.find(({ name }) => name === fieldName)

  return fieldExists
}

const introspectAndStoreRemoteSchema = async () => {
  const state = getStore().getState()
  const { pluginOptions } = state.gatsbyApi
  const { schemaWasChanged } = state.remoteSchema

  let introspectionData = await getCachedRemoteIntrospectionData()

  const printSchemaDiff =
    pluginOptions?.debug?.graphql?.printIntrospectionDiff ||
    pluginOptions?.debug?.preview

  let staleIntrospectionData

  if (!introspectionData || schemaWasChanged) {
    const { data } = await fetchGraphql({
      query: introspectionQuery,
    })

    if (introspectionData) {
      staleIntrospectionData = introspectionData
    }

    introspectionData = data

    const INTROSPECTION_CACHE_KEY = getCachedRemoteIntrospectionDataCacheKey()

    // イントロスペクションのレスポンスをキャッシュする
    await setPersistentCache({
      key: INTROSPECTION_CACHE_KEY,
      value: introspectionData,
    })
  }

  if (staleIntrospectionData && printSchemaDiff) {
    console.log(`\nData changed in WordPress schema:`)
    staleIntrospectionData.__schema.types.forEach(type => {
      const staleTypeJSON = JSON.stringify(type, null, 2)

      const newType = introspectionData.__schema.types.find(
        ({ name }) => name === type.name
      )
      const newTypeJSON = JSON.stringify(newType, null, 2)

      if (staleTypeJSON === newTypeJSON) {
        return
      }

      const typeDiff =
        type && newType ? uniqBy(diff.diffJson(type, newType), `value`) : null

      if (typeDiff?.length) {
        console.log(`\nFound changes to the ${type.name} type\n`)
        typeDiff.forEach(part => {
          if (part.added || part.removed) {
            console.log(
              chalk.green(
                chalk.bold(`${part.added ? `Added` : `Removed`}:\n`) +
                  part.value
                    .trim()
                    .split(`\n`)
                    .map(
                      (line, index) =>
                        `${part.added ? `+` : `-`}${
                          index === 0 ? `\t` : ` `
                        }${line}`
                    )
                    .join(`\n`)
              )
            )
          }
        })
        console.log(`\n`)
      }
    })
  }

  const typeMap = new Map(
    introspectionData.__schema.types.map(type => [type.name, type])
  )

  getStore().dispatch.remoteSchema.setState({ introspectionData, typeMap })
}

export { introspectAndStoreRemoteSchema }
