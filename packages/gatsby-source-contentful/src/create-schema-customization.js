// @ts-check
import _ from "lodash"
import { fetchContentTypes } from "./fetch"
import { createPluginConfig } from "./plugin-options"
import { CODES } from "./report"
import { resolveGatsbyImageData } from "./gatsby-plugin-image"
import { ImageCropFocusType, ImageResizingBehavior } from "./schemes"
import { stripIndent } from "common-tags"
import { addRemoteFilePolyfillInterface } from "gatsby-plugin-utils/polyfill-remote-file"
import { makeTypeName } from "./normalize"

async function getContentTypesFromContentful({
  cache,
  reporter,
  pluginConfig,
}) {
  // Contentful からコンテンツタイプの項目を取得する
  const allContentTypeItems = await fetchContentTypes({
    pluginConfig,
    reporter,
  })

  const contentTypeFilter = pluginConfig.get(`contentTypeFilter`)

  const contentTypeItems = allContentTypeItems.filter(contentTypeFilter)

  if (contentTypeItems.length === 0) {
    reporter.panic({
      id: CODES.ContentTypesMissing,
      context: {
        sourceMessage: `Please check if your contentTypeFilter is configured properly. Content types were filtered down to none.`,
      },
    })
  }

  // 使用が制限されているコンテンツタイプ名を確認し、useNameForId に基づいて id を設定する
  const useNameForId = pluginConfig.get(`useNameForId`)
  const restrictedContentTypes = [`entity`, `reference`, `asset`]

  if (pluginConfig.get(`enableTags`)) {
    restrictedContentTypes.push(`tag`)
  }

  contentTypeItems.forEach(contentTypeItem => {
    // コンテンツタイプの識別子を決める
    //  `name` が指定されていればそれを使い、なければ内部 id を使う（通常は自然言語の定数だが、
    //  Contentful が生成した base62 の uuid のこともあるので、このオプションがある）
    let contentTypeItemId = contentTypeItem.sys.id
    if (useNameForId) {
      contentTypeItemId = contentTypeItem.name.toLowerCase()
    }

    if (restrictedContentTypes.includes(contentTypeItemId)) {
      reporter.panic({
        id: CODES.FetchContentTypes,
        context: {
          sourceMessage: `Restricted ContentType name found. The name "${contentTypeItemId}" is not allowed.`,
        },
      })
    }
  })

  // 処理済みのコンテンツタイプを sourceNodes 用にキャッシュへ保存する
  const sourceId = `${pluginConfig.get(`spaceId`)}-${pluginConfig.get(
    `environment`
  )}`
  const CACHE_CONTENT_TYPES = `contentful-content-types-${sourceId}`
  await cache.set(CACHE_CONTENT_TYPES, contentTypeItems)

  return contentTypeItems
}

export async function createSchemaCustomization(
  { schema, actions, store, reporter, cache },
  pluginOptions
) {
  const { createTypes } = actions

  const pluginConfig = createPluginConfig(pluginOptions)

  const typePrefix = pluginConfig.get(`typePrefix`)
  const useNameForId = pluginConfig.get(`useNameForId`)

  let contentTypeItems
  if (process.env.GATSBY_WORKER_ID) {
    const sourceId = `${pluginConfig.get(`spaceId`)}-${pluginConfig.get(
      `environment`
    )}`
    contentTypeItems = await cache.get(`contentful-content-types-${sourceId}`)
  } else {
    contentTypeItems = await getContentTypesFromContentful({
      cache,
      reporter,
      pluginConfig,
    })
  }
  const { getGatsbyImageFieldConfig } = await import(
    `gatsby-plugin-image/graphql-utils`
  )

  const contentfulTypes = [
    schema.buildInterfaceType({
      name: `ContentfulEntry`,
      fields: {
        contentful_id: { type: `String!` },
        id: { type: `ID!` },
        node_locale: { type: `String!` },
      },
      extensions: { infer: false },
      interfaces: [`Node`],
    }),
    schema.buildInterfaceType({
      name: `ContentfulReference`,
      fields: {
        contentful_id: { type: `String!` },
        id: { type: `ID!` },
      },
      extensions: { infer: false },
    }),
  ]

  contentfulTypes.push(
    addRemoteFilePolyfillInterface(
      schema.buildObjectType({
        name: makeTypeName(`Asset`, typePrefix),
        fields: {
          contentful_id: { type: `String!` },
          id: { type: `ID!` },
          gatsbyImageData: getGatsbyImageFieldConfig(
            async (...args) => resolveGatsbyImageData(...args, { cache }),
            {
              jpegProgressive: {
                type: `Boolean`,
                defaultValue: true,
              },
              resizingBehavior: {
                type: ImageResizingBehavior,
              },
              cropFocus: {
                type: ImageCropFocusType,
              },
              cornerRadius: {
                type: `Int`,
                defaultValue: 0,
                description: stripIndent`
                 Desired corner radius in pixels. Results in an image with rounded corners.
                 Pass \`-1\` for a full circle/ellipse.`,
              },
              quality: {
                type: `Int`,
                defaultValue: 50,
              },
            }
          ),
          ...(pluginConfig.get(`downloadLocal`)
            ? {
                localFile: {
                  type: `File`,
                  extensions: {
                    link: {
                      from: `fields.localFile`,
                    },
                  },
                },
              }
            : {}),
        },
        interfaces: [`ContentfulReference`, `Node`, `RemoteFile`],
      }),
      {
        schema,
        actions,
        store,
      }
    )
  )

  // コンテンツタイプごとに型を作成する
  contentTypeItems.forEach(contentTypeItem =>
    contentfulTypes.push(
      schema.buildObjectType({
        name: makeTypeName(
          useNameForId ? contentTypeItem.name : contentTypeItem.sys.id,
          typePrefix
        ),
        fields: {
          contentful_id: { type: `String!` },
          id: { type: `ID!` },
          node_locale: { type: `String!` },
        },
        interfaces: [`ContentfulReference`, `ContentfulEntry`, `Node`],
      })
    )
  )

  if (pluginConfig.get(`enableTags`)) {
    contentfulTypes.push(
      schema.buildObjectType({
        name: makeTypeName(`Tag`, typePrefix),
        fields: {
          name: { type: `String!` },
          contentful_id: { type: `String!` },
          id: { type: `ID!` },
        },
        interfaces: [`Node`],
        extensions: { infer: false },
      })
    )
  }

  createTypes(contentfulTypes)
}
