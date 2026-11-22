// @ts-check
import stringify from "json-stringify-safe"
import _ from "lodash"
import { getGatsbyVersion } from "gatsby-core-utils"
import { lt, prerelease } from "semver"
import fastq from "fastq"

/**
 * @param {string} type
 * @param {string} typePrefix
 */
export const makeTypeName = (type, typePrefix) =>
  _.upperFirst(_.camelCase(`${typePrefix} ${type}`))

const GATSBY_VERSION_MANIFEST_V2 = `4.3.0`
const gatsbyVersion =
  (typeof getGatsbyVersion === `function` && getGatsbyVersion()) || `0.0.0`
const gatsbyVersionIsPrerelease = prerelease(gatsbyVersion)
const shouldUpgradeGatsbyVersion =
  lt(gatsbyVersion, GATSBY_VERSION_MANIFEST_V2) && !gatsbyVersionIsPrerelease

export const getLocalizedField = ({ field, locale, localesFallback }) => {
  if (!field) {
    return null
  }
  if (!_.isUndefined(field[locale.code])) {
    return field[locale.code]
  } else if (
    !_.isUndefined(locale.code) &&
    !_.isUndefined(localesFallback[locale.code])
  ) {
    return getLocalizedField({
      field,
      locale: { code: localesFallback[locale.code] },
      localesFallback,
    })
  } else {
    return null
  }
}
export const buildFallbackChain = locales => {
  const localesFallback = {}
  _.each(
    locales,
    locale => (localesFallback[locale.code] = locale.fallbackCode)
  )
  return localesFallback
}
const makeGetLocalizedField =
  ({ locale, localesFallback }) =>
  field =>
    getLocalizedField({ field, locale, localesFallback })

export const makeId = ({ spaceId, id, currentLocale, defaultLocale, type }) => {
  const normalizedType = type.startsWith(`Deleted`)
    ? type.substring(`Deleted`.length)
    : type
  return currentLocale === defaultLocale
    ? `${spaceId}___${id}___${normalizedType}`
    : `${spaceId}___${id}___${normalizedType}___${currentLocale}`
}

const makeMakeId =
  ({ currentLocale, defaultLocale, createNodeId }) =>
  (spaceId, id, type) =>
    createNodeId(makeId({ spaceId, id, currentLocale, defaultLocale, type }))

export const buildEntryList = ({ contentTypeItems, currentSyncData }) => {
  // 対象となる型の sys.id ごとにバケットを作る（空であっても、それぞれ必ず配列を用意する）
  const map = new Map(
    contentTypeItems.map(contentType => [contentType.sys.id, []])
  )
  // 次にバケットを埋める。バケットがないエントリーは無視する（filterContentType を使った場合に起こる）
  currentSyncData.entries.map(entry => {
    const arr = map.get(entry.sys.contentType.sys.id)
    if (arr) {
      arr.push(entry)
    }
  })
  // 順序に意味がある。contentTypeItems 配列と 1 対 1 で対応しなければならない
  return contentTypeItems.map(contentType => map.get(contentType.sys.id))
}

export const buildResolvableSet = ({
  entryList,
  existingNodes = new Map(),
  assets = [],
}) => {
  const resolvable = new Set()
  existingNodes.forEach(node => {
    // 追加する必要があるのは、ルートレベルの解決可能なもの（アセットとエントリー）だけである
    // 派生ノード（markdown や JSON）は必要に応じて作り直される。
    resolvable.add(`${node.contentful_id}___${node.sys.type}`)
  })

  entryList.forEach(entries => {
    entries.forEach(entry =>
      resolvable.add(`${entry.sys.id}___${entry.sys.type}`)
    )
  })

  assets.forEach(assetItem =>
    resolvable.add(`${assetItem.sys.id}___${assetItem.sys.type}`)
  )

  return resolvable
}

function cleanupReferencesFromEntry(foreignReferenceMapState, entry) {
  const { links, backLinks } = foreignReferenceMapState
  const entryId = entry.sys.id

  const entryLinks = links[entryId]
  if (entryLinks) {
    entryLinks.forEach(link => {
      const backLinksForLink = backLinks[link]
      if (backLinksForLink) {
        const newBackLinks = backLinksForLink.filter(({ id }) => id !== entryId)
        if (newBackLinks.lenth > 0) {
          backLinks[link] = newBackLinks
        } else {
          delete backLinks[link]
        }
      }
    })
  }

  delete links[entryId]
}

export const buildForeignReferenceMap = ({
  contentTypeItems,
  entryList,
  resolvable,
  defaultLocale,
  space,
  useNameForId,
  previousForeignReferenceMapState,
  deletedEntries,
}) => {
  const foreignReferenceMapState = previousForeignReferenceMapState || {
    links: {},
    backLinks: {},
  }

  const { links, backLinks } = foreignReferenceMapState

  for (const deletedEntry of deletedEntries) {
    // 削除されるエントリーから、保存済みのエントリーを取り除く
    cleanupReferencesFromEntry(foreignReferenceMapState, deletedEntry)
  }

  contentTypeItems.forEach((contentTypeItem, i) => {
    // コンテンツタイプの識別子を決める
    //  `name` が指定されていればそれを使い、なければ内部 id を使う（通常は自然言語の定数だが、
    //  Contentful が生成した base62 の uuid のこともあるので、このオプションがある）
    let contentTypeItemId
    if (useNameForId) {
      contentTypeItemId = contentTypeItem.name.toLowerCase()
    } else {
      contentTypeItemId = contentTypeItem.sys.id.toLowerCase()
    }

    entryList[i].forEach(entryItem => {
      // このエントリーについて以前の実行で追加されたリンクを消去する。いずれにせよ作り直すためである
      cleanupReferencesFromEntry(foreignReferenceMapState, entryItem)

      const entryItemFields = entryItem.fields
      Object.keys(entryItemFields).forEach(entryItemFieldKey => {
        if (entryItemFields[entryItemFieldKey]) {
          const entryItemFieldValue =
            entryItemFields[entryItemFieldKey][defaultLocale]
          // 単一の参照オブジェクトの配列であれば
          // 参照マップに追加し、そうでなければ無視する。
          if (Array.isArray(entryItemFieldValue)) {
            if (
              entryItemFieldValue[0] &&
              entryItemFieldValue[0].sys &&
              entryItemFieldValue[0].sys.type &&
              entryItemFieldValue[0].sys.id
            ) {
              entryItemFieldValue.forEach(v => {
                const key = `${v.sys.id}___${v.sys.linkType || v.sys.type}`
                // 解決できないフィールドへのリンクは作成しない。
                if (!resolvable.has(key)) {
                  return
                }

                if (!backLinks[key]) {
                  backLinks[key] = []
                }
                backLinks[key].push({
                  name: `${contentTypeItemId}___NODE`,
                  id: entryItem.sys.id,
                  spaceId: space.sys.id,
                  type: entryItem.sys.type,
                })

                if (!links[entryItem.sys.id]) {
                  links[entryItem.sys.id] = []
                }

                links[entryItem.sys.id].push(key)
              })
            }
          } else if (
            entryItemFieldValue?.sys?.type &&
            entryItemFieldValue.sys.id
          ) {
            const key = `${entryItemFieldValue.sys.id}___${
              entryItemFieldValue.sys.linkType || entryItemFieldValue.sys.type
            }`
            // 解決できないフィールドへのリンクは作成しない。
            if (!resolvable.has(key)) {
              return
            }

            if (!backLinks[key]) {
              backLinks[key] = []
            }
            backLinks[key].push({
              name: `${contentTypeItemId}___NODE`,
              id: entryItem.sys.id,
              spaceId: space.sys.id,
              type: entryItem.sys.type,
            })

            if (!links[entryItem.sys.id]) {
              links[entryItem.sys.id] = []
            }

            links[entryItem.sys.id].push(key)
          }
        }
      })
    })
  })

  return foreignReferenceMapState
}

function prepareTextNode(id, node, key, text) {
  const str = _.isString(text) ? text : ``
  const textNode = {
    id,
    parent: node.id,
    children: [],
    [key]: str,
    internal: {
      type: _.camelCase(`${node.internal.type} ${key} TextNode`),
      mediaType: `text/markdown`,
      content: str,
      // entryItem.sys.updatedAt は contentful 側の信頼できる情報源である
      contentDigest: node.updatedAt,
    },
    sys: {
      type: `TextNode`,
    },
  }

  node.children = node.children.concat([id])

  return textNode
}

function prepareJSONNode(id, node, key, content) {
  const str = JSON.stringify(content)
  const JSONNode = {
    ...(_.isPlainObject(content) ? { ...content } : { content: content }),
    id,
    parent: node.id,
    children: [],
    internal: {
      type: _.camelCase(`${node.internal.type} ${key} JSONNode`),
      mediaType: `application/json`,
      content: str,
      // entryItem.sys.updatedAt は contentful 側の信頼できる情報源である
      contentDigest: node.updatedAt,
    },
    sys: {
      type: `JsonNode`,
    },
  }

  node.children = node.children.concat([id])

  return JSONNode
}

let numberOfContentSyncDebugLogs = 0
const maxContentSyncDebugLogTimes = 50

let warnOnceForNoSupport = false
let warnOnceToUpgradeGatsby = false

/**
 * この関数はノードマニフェストを作成する。ノードマニフェストは、Content Sync の API と機能による Gatsby Cloud のプレビューで使われる。
 * Content Sync は、ユーザーを Contentful から、プレビューしたいエントリーのデータで作られたページへ案内する。
 */

function contentfulCreateNodeManifest({
  pluginConfig,
  entryItem,
  entryNode,
  space,
  unstable_createNodeManifest,
}) {
  const isPreview = pluginConfig.get(`host`) === `preview.contentful.com`

  const createNodeManifestIsSupported =
    typeof unstable_createNodeManifest === `function`

  const shouldCreateNodeManifest = isPreview && createNodeManifestIsSupported

  const updatedAt = entryItem.sys.updatedAt

  const manifestId = `${space.sys.id}-${entryItem.sys.id}-${updatedAt}`

  if (
    process.env.CONTENTFUL_DEBUG_NODE_MANIFEST === `true` &&
    numberOfContentSyncDebugLogs <= maxContentSyncDebugLogTimes
  ) {
    numberOfContentSyncDebugLogs++

    console.info(
      JSON.stringify({
        isPreview,
        createNodeManifestIsSupported,
        shouldCreateNodeManifest,
        manifestId,
        entryItemSysUpdatedAt: updatedAt,
      })
    )
  }

  if (shouldCreateNodeManifest) {
    if (shouldUpgradeGatsbyVersion && !warnOnceToUpgradeGatsby) {
      console.warn(
        `Your site is doing more work than it needs to for Preview, upgrade to Gatsby ^${GATSBY_VERSION_MANIFEST_V2} for better performance`
      )
      warnOnceToUpgradeGatsby = true
    }

    unstable_createNodeManifest({
      manifestId,
      node: entryNode,
      updatedAtUTC: updatedAt,
    })
  } else if (
    isPreview &&
    !createNodeManifestIsSupported &&
    !warnOnceForNoSupport
  ) {
    console.warn(
      `Contentful: Your version of Gatsby core doesn't support Content Sync (via the unstable_createNodeManifest action). Please upgrade to the latest version to use Content Sync in your site.`
    )
    warnOnceForNoSupport = true
  }
}

function makeQueuedCreateNode({ nodeCount, createNode }) {
  if (nodeCount > 5000) {
    let createdNodeCount = 0

    const createNodesQueue = fastq((node, cb) => {
      function runCreateNode() {
        const maybeNodePromise = createNode(node)

        // `.then` の有無を確認するほうが、`instanceof Promise` を使うよりはるかに高速である
        if (`then` in maybeNodePromise) {
          maybeNodePromise.then(() => {
            cb(null)
          })
        } else {
          cb(null)
        }
      }

      if (++createdNodeCount % 100 === 0) {
        setImmediate(() => {
          runCreateNode()
        })
      } else {
        runCreateNode()
      }
    }, 10)

    const queueFinished = new Promise(resolve => {
      createNodesQueue.drain = () => {
        resolve(null)
      }
    })

    return {
      create: (node, callback) => createNodesQueue.push(node, callback),
      createNodesPromise: queueFinished,
    }
  } else {
    const nodePromises = []
    const queueFinished = () => Promise.all(nodePromises)

    return {
      create: node => nodePromises.push(createNode(node)),
      createNodesPromise: queueFinished(),
    }
  }
}

export const createNodesForContentType = async ({
  contentTypeItem,
  restrictedNodeFields,
  conflictFieldPrefix,
  entries,
  unstable_createNodeManifest,
  createNode,
  createNodeId,
  getNode,
  resolvable,
  foreignReferenceMap,
  defaultLocale,
  locales,
  space,
  useNameForId,
  pluginConfig,
}) => {
  const { create, createNodesPromise } = makeQueuedCreateNode({
    nodeCount: entries.length,
    createNode,
  })

  const typePrefix = pluginConfig.get(`typePrefix`)

  // コンテンツタイプの識別子を決める
  //  `name` が指定されていればそれを使い、なければ内部 id を使う（通常は自然言語の定数だが、
  //  Contentful が生成した base62 の uuid のこともあるので、このオプションがある）
  let contentTypeItemId
  if (useNameForId) {
    contentTypeItemId = contentTypeItem.name
  } else {
    contentTypeItemId = contentTypeItem.sys.id
  }

  // コンテンツタイプのノードを作成する
  const contentTypeNode = {
    id: createNodeId(contentTypeItemId),
    parent: null,
    children: [],
    name: contentTypeItem.name,
    displayField: contentTypeItem.displayField,
    description: contentTypeItem.description,
    internal: {
      type: `${makeTypeName(`ContentType`, typePrefix)}`,
      contentDigest: contentTypeItem.sys.updatedAt,
    },
    sys: {
      type: contentTypeItem.sys.type,
    },
  }

  create(contentTypeNode)

  locales.forEach(locale => {
    const localesFallback = buildFallbackChain(locales)
    const mId = makeMakeId({
      currentLocale: locale.code,
      defaultLocale,
      createNodeId,
    })
    const getField = makeGetLocalizedField({
      locale,
      localesFallback,
    })

    // フィールドの衝突があれば警告する
    const conflictFields = []
    contentTypeItem.fields.forEach(contentTypeItemField => {
      const fieldName = contentTypeItemField.id
      if (restrictedNodeFields.includes(fieldName)) {
        console.log(
          `Restricted field found for ContentType ${contentTypeItemId} and field ${fieldName}. Prefixing with ${conflictFieldPrefix}.`
        )
        conflictFields.push(fieldName)
      }
    })

    const childrenNodes = []

    // まず、そのコンテンツタイプの各エントリーのノードを作成する
    const entryNodes = entries.map(entryItem => {
      const entryNodeId = mId(
        space.sys.id,
        entryItem.sys.id,
        entryItem.sys.type
      )

      const existingNode = getNode(entryNodeId)
      if (existingNode?.updatedAt === entryItem.sys.updatedAt) {
        // Contentful のモデルでは、エントリーについて `.sys.updatedAt` が基準になる。エントリーの updatedAt の値が
        // 変わっていなければ、その子も変更されていないと信頼できる。
        return null
      }

      // ローカライズされたフィールドを取得する。
      const entryItemFields = _.mapValues(entryItem.fields, (v, k) => {
        const fieldProps = contentTypeItem.fields.find(field => field.id === k)

        const localizedField = fieldProps.localized
          ? getField(v)
          : v[defaultLocale]

        return localizedField
      })

      // 衝突するフィールドには接頭辞を付ける
      // https://github.com/gatsbyjs/gatsby/pull/1084#pullrequestreview-41662888
      conflictFields.forEach(conflictField => {
        entryItemFields[`${conflictFieldPrefix}${conflictField}`] =
          entryItemFields[conflictField]
        delete entryItemFields[conflictField]
      })

      // 外部参照に基づいて、ほかのノードへのリンクを追加する
      Object.keys(entryItemFields).forEach(entryItemFieldKey => {
        if (entryItemFields[entryItemFieldKey]) {
          const entryItemFieldValue = entryItemFields[entryItemFieldKey]
          if (Array.isArray(entryItemFieldValue)) {
            if (entryItemFieldValue[0]?.sys?.type === `Link`) {
              // entryItemFieldValue に値があるかを確認する。存在しないエンティティへの
              // リンクのために元のキーフィールドの値が空になっている場合に、
              // 空のノードフィールドを作らないようにするためである
              const resolvableEntryItemFieldValue = entryItemFieldValue
                .filter(function (v) {
                  return resolvable.has(
                    `${v.sys.id}___${v.sys.linkType || v.sys.type}`
                  )
                })
                .map(function (v) {
                  return mId(
                    space.sys.id,
                    v.sys.id,
                    v.sys.linkType || v.sys.type
                  )
                })
              if (resolvableEntryItemFieldValue.length !== 0) {
                entryItemFields[`${entryItemFieldKey}___NODE`] =
                  resolvableEntryItemFieldValue
              }

              delete entryItemFields[entryItemFieldKey]
            }
          } else if (entryItemFieldValue?.sys?.type === `Link`) {
            if (
              resolvable.has(
                `${entryItemFieldValue.sys.id}___${
                  entryItemFieldValue.sys.linkType ||
                  entryItemFieldValue.sys.type
                }`
              )
            ) {
              entryItemFields[`${entryItemFieldKey}___NODE`] = mId(
                space.sys.id,
                entryItemFieldValue.sys.id,
                entryItemFieldValue.sys.linkType || entryItemFieldValue.sys.type
              )
            }
            delete entryItemFields[entryItemFieldKey]
          }
        }
      })

      // このノードに逆方向のリンクがあれば追加する
      const foreignReferences =
        foreignReferenceMap[`${entryItem.sys.id}___${entryItem.sys.type}`]
      if (foreignReferences) {
        foreignReferences.forEach(foreignReference => {
          const existingReference = entryItemFields[foreignReference.name]
          if (existingReference) {
            // 既存の参照が文字列であれば、すでに記録済みの多対 1 の参照なので
            // スキップできる。配列であれば追加する:
            if (Array.isArray(existingReference)) {
              entryItemFields[foreignReference.name].push(
                mId(
                  foreignReference.spaceId,
                  foreignReference.id,
                  foreignReference.type
                )
              )
            }
          } else {
            // 外部参照が 1 つあれば、複数あることもあり得る。
            // 安全のため、最初から配列に入れておく。
            entryItemFields[foreignReference.name] = [
              mId(
                foreignReference.spaceId,
                foreignReference.id,
                foreignReference.type
              ),
            ]
          }
        })
      }

      let entryNode = {
        id: entryNodeId,
        spaceId: space.sys.id,
        contentful_id: entryItem.sys.id,
        createdAt: entryItem.sys.createdAt,
        updatedAt: entryItem.sys.updatedAt,
        parent: null,
        children: [],
        internal: {
          type: `${makeTypeName(contentTypeItemId, typePrefix)}`,
        },
        sys: {
          type: entryItem.sys.type,
        },
      }

      contentfulCreateNodeManifest({
        pluginConfig,
        entryItem,
        entryNode,
        space,
        unstable_createNodeManifest,
      })

      // リビジョンは、エントリー、アセット、コンテンツタイプに適用される
      if (entryItem.sys.revision) {
        entryNode.sys.revision = entryItem.sys.revision
      }

      // コンテンツタイプはエントリーにだけ適用される
      if (entryItem.sys.contentType) {
        entryNode.sys.contentType = entryItem.sys.contentType
      }

      // テキストフィールドをテキストノードに置き換え、その markdown を HTML に
      // 処理できるようにする。
      Object.keys(entryItemFields).forEach(entryItemFieldKey => {
        // "___node" の付いたフィールドは処理済みであり、テキストフィールドでもないので
        // 無視する。
        if (entryItemFieldKey.includes(`___`)) {
          return
        }

        const fieldType = contentTypeItem.fields.find(
          f =>
            (restrictedNodeFields.includes(f.id)
              ? `${conflictFieldPrefix}${f.id}`
              : f.id) === entryItemFieldKey
        ).type
        if (fieldType === `Text`) {
          const textNodeId = createNodeId(
            `${entryNodeId}${entryItemFieldKey}TextNode`
          )

          // Contentful のモデルでは、エントリーについて `.sys.updatedAt` が基準になる。エントリーの updatedAt の値が
          // 変わっていなければ、その子も変更されていないと信頼できる。
          // （そのため、子ノードもダイジェストとして親ノードの updatedAt を使う）
          const existingNode = getNode(textNodeId)
          if (existingNode?.updatedAt !== entryItem.sys.updatedAt) {
            const textNode = prepareTextNode(
              textNodeId,
              entryNode,
              entryItemFieldKey,
              entryItemFields[entryItemFieldKey]
            )

            childrenNodes.push(textNode)
          }

          entryItemFields[`${entryItemFieldKey}___NODE`] = textNodeId
          delete entryItemFields[entryItemFieldKey]
        } else if (
          fieldType === `RichText` &&
          _.isPlainObject(entryItemFields[entryItemFieldKey])
        ) {
          const fieldValue = entryItemFields[entryItemFieldKey]

          const rawReferences = []

          // リッチテキストのデータに含まれる Contentful のリンクをすべて見つける
          const traverse = obj => {
            // eslint-disable-next-line guard-for-in
            for (const k in obj) {
              const v = obj[k]
              if (v && v.sys && v.sys.type === `Link`) {
                rawReferences.push(v)
              } else if (v && typeof v === `object`) {
                traverse(v)
              }
            }
          }

          traverse(fieldValue)

          // 解決可能な参照の一覧を組み立てる
          const resolvableReferenceIds = new Set()
          rawReferences
            .filter(function (v) {
              return resolvable.has(
                `${v.sys.id}___${v.sys.linkType || v.sys.type}`
              )
            })
            .forEach(function (v) {
              resolvableReferenceIds.add(
                mId(space.sys.id, v.sys.id, v.sys.linkType || v.sys.type)
              )
            })

          entryItemFields[entryItemFieldKey] = {
            raw: stringify(fieldValue),
            references___NODE: [...resolvableReferenceIds],
          }
        } else if (
          fieldType === `Object` &&
          _.isPlainObject(entryItemFields[entryItemFieldKey])
        ) {
          const jsonNodeId = createNodeId(
            `${entryNodeId}${entryItemFieldKey}JSONNode`
          )

          // Contentful のモデルでは、エントリーについて `.sys.updatedAt` が基準になる。エントリーの updatedAt の値が
          // 変わっていなければ、その子も変更されていないと信頼できる。
          // （そのため、子ノードもダイジェストとして親ノードの updatedAt を使う）
          const existingNode = getNode(jsonNodeId)
          if (existingNode?.updatedAt !== entryItem.sys.updatedAt) {
            const jsonNode = prepareJSONNode(
              jsonNodeId,
              entryNode,
              entryItemFieldKey,
              entryItemFields[entryItemFieldKey]
            )
            childrenNodes.push(jsonNode)
          }

          entryItemFields[`${entryItemFieldKey}___NODE`] = jsonNodeId
          delete entryItemFields[entryItemFieldKey]
        } else if (
          fieldType === `Object` &&
          _.isArray(entryItemFields[entryItemFieldKey])
        ) {
          entryItemFields[`${entryItemFieldKey}___NODE`] = []

          entryItemFields[entryItemFieldKey].forEach((obj, i) => {
            const jsonNodeId = createNodeId(
              `${entryNodeId}${entryItemFieldKey}${i}JSONNode`
            )

            // Contentful のモデルでは、エントリーについて `.sys.updatedAt` が基準になる。エントリーの updatedAt の値が
            // 変わっていなければ、その子も変更されていないと信頼できる。
            // （そのため、子ノードもダイジェストとして親ノードの updatedAt を使う）
            const existingNode = getNode(jsonNodeId)
            if (existingNode?.updatedAt !== entryItem.sys.updatedAt) {
              const jsonNode = prepareJSONNode(
                jsonNodeId,
                entryNode,
                entryItemFieldKey,
                obj
              )
              childrenNodes.push(jsonNode)
            }

            entryItemFields[`${entryItemFieldKey}___NODE`].push(jsonNodeId)
          })

          delete entryItemFields[entryItemFieldKey]
        }
      })

      entryNode = {
        ...entryItemFields,
        ...entryNode,
        node_locale: locale.code,
      }

      // エントリーの内容が更新されているのは、.sys.updatedAt フィールドが変わった場合に限られることが保証されている
      entryNode.internal.contentDigest = entryItem.sys.updatedAt

      // タグをリンクする
      if (pluginConfig.get(`enableTags`)) {
        entryNode.metadata = {
          tags___NODE: entryItem.metadata.tags.map(tag =>
            createNodeId(`ContentfulTag__${space.sys.id}__${tag.sys.id}`)
          ),
        }
      }

      return entryNode
    })

    entryNodes.forEach((entryNode, index) => {
      // ノードが以前に作成済みの場合、ここではエントリーノードが undefined のことがある
      if (entryNode) {
        create(entryNode, () => {
          entryNodes[index] = undefined
        })
      }
    })
    childrenNodes.forEach((entryNode, index) => {
      // ノードが以前に作成済みの場合、ここではエントリーノードが undefined のことがある
      if (entryNode) {
        create(entryNode, () => {
          childrenNodes[index] = undefined
        })
      }
    })
  })

  return createNodesPromise
}

export const createAssetNodes = async ({
  assetItem,
  createNode,
  createNodeId,
  defaultLocale,
  locales,
  space,
  pluginConfig,
}) => {
  const { create, createNodesPromise } = makeQueuedCreateNode({
    createNode,
    nodeCount: locales.length,
  })

  const assetNodes = []

  locales.forEach(locale => {
    const localesFallback = buildFallbackChain(locales)
    const mId = makeMakeId({
      currentLocale: locale.code,
      defaultLocale,
      createNodeId,
    })
    const getField = makeGetLocalizedField({
      locale,
      localesFallback,
    })

    const file = getField(assetItem.fields?.file) ?? null

    // Preview API では、空のアセットと未処理のアセットをスキップする
    if (!file || !file.url || !file.contentType || !file.fileName) {
      return
    }

    const assetNode = {
      contentful_id: assetItem.sys.id,
      spaceId: space.sys.id,
      id: mId(space.sys.id, assetItem.sys.id, assetItem.sys.type),
      createdAt: assetItem.sys.createdAt,
      updatedAt: assetItem.sys.updatedAt,
      parent: null,
      children: [],
      file,
      title: assetItem.fields.title ? getField(assetItem.fields.title) : ``,
      description: assetItem.fields.description
        ? getField(assetItem.fields.description)
        : ``,
      node_locale: locale.code,
      internal: {
        type: makeTypeName(`Asset`, pluginConfig.get(`typePrefix`)),
      },
      sys: {
        type: assetItem.sys.type,
      },
      url: `https:${file.url}`,
      placeholderUrl: `https:${file.url}?w=%width%&h=%height%`,
      // Preview API と Contentful のアセット処理でのエッジケースのため、これらのフィールドは省略可能である
      mimeType: file.contentType,
      filename: file.fileName,
      width: file.details?.image?.width ?? null,
      height: file.details?.image?.height ?? null,
      size: file.details?.size ?? null,
    }

    // タグをリンクする
    if (pluginConfig.get(`enableTags`)) {
      assetNode.metadata = {
        tags___NODE: assetItem.metadata.tags.map(tag =>
          createNodeId(`ContentfulTag__${space.sys.id}__${tag.sys.id}`)
        ),
      }
    }

    // リビジョンは、エントリー、アセット、コンテンツタイプに適用される
    if (assetItem.sys.revision) {
      assetNode.sys.revision = assetItem.sys.revision
    }

    // エントリーの内容が更新されているのは、.sys.updatedAt フィールドが変わった場合に限られることが保証されている
    assetNode.internal.contentDigest = assetItem.sys.updatedAt

    assetNodes.push(assetNode)
    create(assetNode)
  })

  await createNodesPromise
  return assetNodes
}
