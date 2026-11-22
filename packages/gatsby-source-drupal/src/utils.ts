import _ from "lodash"

import {
  nodeFromData,
  downloadFile,
  isFileNode,
  createNodeIdWithVersion,
} from "./normalize"

import { getOptions } from "./plugin-options"

import { getGatsbyVersion } from "gatsby-core-utils"
import { lt, prerelease } from "semver"

function makeBackRefsKey(id) {
  return `backrefs-${id}`
}

function makeRefNodesKey(id) {
  return `refnodes-${id}`
}

export async function handleReferences(
  node,
  {
    getNode,
    mutateNode = false,
    createNodeId,
    entityReferenceRevisions = [],
    cache,
    pluginOptions,
  }
) {
  const relationships = node.relationships
  const rootNodeLanguage = getOptions().languageConfig ? node.langcode : `und`

  const backReferencedNodes: Array<string> = []
  if (node.drupal_relationships) {
    const referencedNodes: Array<string> = []
    _.each(node.drupal_relationships, (v, k) => {
      if (!v.data) return

      const nodeFieldName = `${k}___NODE`
      if (_.isArray(v.data)) {
        relationships[nodeFieldName] = _.compact(
          v.data.map(data => {
            const referencedNodeId = createNodeId(
              createNodeIdWithVersion({
                id: data.id,
                type: data.type,
                langcode: rootNodeLanguage,
                revisionId: data.meta?.target_version,
                entityReferenceRevisions,
                typePrefix: pluginOptions.typePrefix,
              })
            )
            if (!getNode(referencedNodeId)) {
              return null
            }

            referencedNodes.push(referencedNodeId)
            return referencedNodeId
          })
        )

        const meta = _.compact(
          v.data.map(data => (!_.isEmpty(data.meta) ? data.meta : null))
        )
        // フィールドに meta があり、それが既存または内部のものでなければ、
        // その meta で新しいノードのフィールドを作成する。両方に存在することはできない
        // @see https://jsonapi.org/format/#document-resource-object-fields
        if (!_.isEmpty(meta) && !(k in node)) {
          node[k] = meta
        }
      } else {
        const referencedNodeId = createNodeId(
          createNodeIdWithVersion({
            id: v.data.id,
            type: v.data.type,
            langcode: rootNodeLanguage,
            revisionId: v.data.meta?.target_revision_id,
            entityReferenceRevisions,
            typePrefix: pluginOptions.typePrefix,
          })
        )
        if (getNode(referencedNodeId)) {
          relationships[nodeFieldName] = referencedNodeId
          referencedNodes.push(referencedNodeId)
        }

        // フィールドに meta があり、それが既存または内部のものでなければ、
        // その meta で新しいノードのフィールドを作成する。両方に存在することはできない
        // @see https://jsonapi.org/format/#document-resource-object-fields
        if (!_.isEmpty(v.data.meta) && !(k in node)) {
          node[k] = v.data.meta
        }
      }
    })

    delete node.drupal_relationships
    await cache.set(makeRefNodesKey(node.id), referencedNodes)
    if (referencedNodes.length) {
      const nodeFieldName = `${node.internal.type}___NODE`
      for (const nodeId of referencedNodes) {
        let referencedNode
        if (mutateNode) {
          referencedNode = getNode(nodeId)
        } else {
          referencedNode = _.cloneDeep(getNode(nodeId))
        }
        if (!referencedNode.relationships[nodeFieldName]) {
          referencedNode.relationships[nodeFieldName] = []
        }

        if (!referencedNode.relationships[nodeFieldName].includes(node.id)) {
          referencedNode.relationships[nodeFieldName].push(node.id)
        }

        let backRefsNames = await cache.get(makeBackRefsKey(referencedNode.id))
        if (!backRefsNames) {
          backRefsNames = []
          await cache.set(makeBackRefsKey(referencedNode.id), backRefsNames)
        }

        if (!backRefsNames.includes(nodeFieldName)) {
          backRefsNames.push(nodeFieldName)
          await cache.set(makeBackRefsKey(referencedNode.id), backRefsNames)
        }
        backReferencedNodes.push(referencedNode)
      }
    }
  }

  node.relationships = relationships

  return backReferencedNodes
}

export const handleDeletedNode = async ({
  actions,
  node,
  getNode,
  createNodeId,
  createContentDigest,
  cache,
  entityReferenceRevisions,
  pluginOptions,
}) => {
  let deletedNode = getNode(
    createNodeId(
      createNodeIdWithVersion({
        id: node.id,
        type: node.type,
        langcode: getOptions().languageConfig
          ? node.attributes?.langcode
          : `und`,
        revisionId: node.attributes?.drupal_internal__revision_id,
        entityReferenceRevisions,
        typePrefix: pluginOptions.typePrefix,
      })
    )
  )

  // ノードがすでに削除されていて、Drupal が古いノードへの参照を
  // 送ってきているのかもしれない。
  if (!deletedNode) {
    return deletedNode
  }

  // 元のノードを書き換えないよう、ノードをクローンする。
  deletedNode = _.cloneDeep(deletedNode)

  await cache.del(makeBackRefsKey(deletedNode.id))
  await cache.del(makeRefNodesKey(deletedNode.id))

  // ほかのノードからリレーションシップを取り除き、作り直す。
  Object.keys(deletedNode.relationships).forEach(async key => {
    let ids = deletedNode.relationships[key]
    ids = [].concat(ids)
    for (const id of ids) {
      let node = getNode(id)

      // 参照先のノードはすでに削除されている可能性がある。
      if (node) {
        // 元のノードを書き換えないよう、ノードをクローンする。
        node = _.cloneDeep(node)
        let referencedNodes = await cache.get(makeRefNodesKey(node.id))

        if (referencedNodes?.includes(deletedNode.id)) {
          // リレーションシップを順に処理し、参照を整理する。
          Object.entries(
            node.relationships as Record<string, string | Array<string>>
          ).forEach(([key, value]) => {
            // 文字列の参照が一致すれば削除する。
            if (_.isString(value) && value === deletedNode.id) {
              delete node.relationships[key]
            }

            // 配列の場合はフィルターをかけ、配列が空になったかを確認して、
            // 空であれば削除する
            if (Array.isArray(value)) {
              value = value.filter(v => v !== deletedNode.id)

              if (value.length === 0) {
                delete node.relationships[key]
              } else {
                node.relationships[key] = value
              }
            }
          })

          // 削除されたノードを referencedNodes の配列から取り除く
          referencedNodes = referencedNodes.filter(
            nId => nId !== deletedNode.id
          )
          await cache.set(makeRefNodesKey(node.id), referencedNodes)
        }

        // リレーションシップを整理し終えた参照先のノードを作り直す。
        if (node.internal.owner) {
          delete node.internal.owner
        }
        if (node.fields) {
          delete node.fields
        }
        node.internal.contentDigest = createContentDigest(node)
        actions.createNode(node)
      }
    }
  })

  actions.deleteNode(deletedNode)

  return deletedNode
}

export async function createNodeIfItDoesNotExist({
  nodeToUpdate,
  actions,
  createNodeId,
  createContentDigest,
  getNode,
  reporter,
  pluginOptions,
}) {
  if (!nodeToUpdate) {
    reporter.warn(
      `The updated node was empty. The fact you're seeing this warning means there's probably a bug in how we're creating and processing updates from Drupal.

${JSON.stringify(nodeToUpdate, null, 4)}
      `
    )

    return
  }

  const { createNode } = actions
  const newNodeId = createNodeId(
    createNodeIdWithVersion({
      id: nodeToUpdate.id,
      type: nodeToUpdate.type,
      langcode: getOptions().languageConfig ? nodeToUpdate.langcode : `und`,
      revisionId: nodeToUpdate.meta?.target_version,
      entityReferenceRevisions: getOptions().entityReferenceRevisions,
      typePrefix: pluginOptions.typePrefix,
    })
  )

  const oldNode = getNode(newNodeId)
  // ノードがまだ存在しないので、ここで作成する。
  if (!oldNode) {
    const newNode = await nodeFromData(
      nodeToUpdate,
      createNodeId,
      getOptions().entityReferenceRevisions,
      pluginOptions,
      null,
      reporter
    )

    newNode.internal.contentDigest = createContentDigest(newNode)
    createNode(newNode)
  }
}

export const handleWebhookUpdate = async (
  {
    nodeToUpdate,
    actions,
    cache,
    createNodeId,
    createContentDigest,
    getCache,
    getNode,
    reporter,
  },
  pluginOptions: Record<string, any> = {}
) => {
  if (!nodeToUpdate) {
    reporter.warn(
      `The updated node was empty. The fact you're seeing this warning means there's probably a bug in how we're creating and processing updates from Drupal.

${JSON.stringify(nodeToUpdate, null, 4)}
      `
    )

    return
  }

  reporter.log(
    `[drupal]: handling update to:
    - entity href: ${nodeToUpdate.links?.self?.href}
    - node id: ${nodeToUpdate.attributes?.drupal_internal__nid}
`
  )

  const { createNode, unstable_createNodeManifest } = actions

  const newNode = await nodeFromData(
    nodeToUpdate,
    createNodeId,
    pluginOptions.entityReferenceRevisions,
    pluginOptions,
    null,
    reporter
  )

  drupalCreateNodeManifest({
    attributes: nodeToUpdate.attributes,
    gatsbyNode: newNode,
    unstable_createNodeManifest,
  })

  const nodesToUpdate = [newNode]

  const oldNodeReferencedNodes = await cache.get(makeRefNodesKey(newNode.id))
  const backReferencedNodes = await handleReferences(newNode, {
    getNode,
    mutateNode: false,
    createNodeId,
    cache,
    entityReferenceRevisions: pluginOptions.entityReferenceRevisions,
    pluginOptions,
  })

  nodesToUpdate.push(...backReferencedNodes)

  let oldNode = getNode(newNode.id)
  if (oldNode) {
    // 元のノードを書き換えないよう、ノードをクローンする。
    oldNode = _.cloneDeep(oldNode)
    // 古いノードからバックリファレンスをコピーする
    const backRefsNames = await cache.get(makeBackRefsKey(oldNode.id))
    if (backRefsNames) {
      await cache.set(makeBackRefsKey(newNode.id), backRefsNames)
      backRefsNames.forEach(backRefFieldName => {
        newNode.relationships[backRefFieldName] =
          oldNode.relationships[backRefFieldName]
      })
    }

    const newNodeReferencedNodes = await cache.get(makeRefNodesKey(newNode.id))
    // 参照されなくなったノードを調べ、そこから backRefs を取り除く
    let removedReferencedNodes = _.difference(
      oldNodeReferencedNodes,
      newNodeReferencedNodes
    ).map(id => getNode(id))

    removedReferencedNodes = removedReferencedNodes.map(node => {
      if (node) {
        return _.cloneDeep(node)
      } else {
        return node
      }
    })

    nodesToUpdate.push(...removedReferencedNodes)

    const nodeFieldName = `${newNode.internal.type}___NODE`
    removedReferencedNodes.forEach(referencedNode => {
      if (
        referencedNode.relationships &&
        referencedNode.relationships[nodeFieldName]
      ) {
        referencedNode.relationships[nodeFieldName] =
          referencedNode.relationships[nodeFieldName].filter(
            id => id !== newNode.id
          )
      }
    })
  }

  // ファイルをダウンロードする。
  const { skipFileDownloads, typePrefix } = pluginOptions
  if (isFileNode(newNode, typePrefix) && !skipFileDownloads) {
    await downloadFile(
      {
        node: newNode,
        cache,
        createNode,
        createNodeId,
        getCache,
      },
      pluginOptions
    )
  }

  for (const node of nodesToUpdate) {
    if (node.internal.owner) {
      delete node.internal.owner
    }
    if (node.fields) {
      delete node.fields
    }
    node.internal.contentDigest = createContentDigest(node)
    createNode(node)
    reporter.log(
      `Updated Gatsby node — id: ${node.id} type: ${node.internal.type}`
    )
  }
}

const GATSBY_VERSION_MANIFEST_V2 = `4.3.0`
const gatsbyVersion =
  (typeof getGatsbyVersion === `function` && getGatsbyVersion()) || `0.0.0`
const gatsbyVersionIsPrerelease = prerelease(gatsbyVersion)
const shouldUpgradeGatsbyVersion =
  lt(gatsbyVersion, GATSBY_VERSION_MANIFEST_V2) && !gatsbyVersionIsPrerelease

let warnOnceForNoSupport = false
let warnOnceToUpgradeGatsby = false

/**
 * この関数はノードマニフェストを作成する。ノードマニフェストは、Content Sync の API と機能による Gatsby Cloud のプレビューで使われる。
 * Content Sync は、ユーザーを Drupal から、プレビューしたいエントリーのデータで作られたページへ案内する。
 */
export function drupalCreateNodeManifest({
  attributes,
  gatsbyNode,
  unstable_createNodeManifest,
}) {
  const isPreview =
    (process.env.NODE_ENV === `development` &&
      process.env.ENABLE_GATSBY_REFRESH_ENDPOINT) ||
    process.env.GATSBY_IS_PREVIEW === `true`

  const updatedAt = attributes?.revision_timestamp
  const id = attributes?.drupal_internal__nid
  const langcode = attributes?.langcode

  const supportsContentSync = typeof unstable_createNodeManifest === `function`
  const shouldCreateNodeManifest =
    id && updatedAt && supportsContentSync && isPreview

  if (shouldCreateNodeManifest) {
    if (shouldUpgradeGatsbyVersion && !warnOnceToUpgradeGatsby) {
      console.warn(
        `Your site is doing more work than it needs to for Preview, upgrade to Gatsby ^${GATSBY_VERSION_MANIFEST_V2} for better performance`
      )
      warnOnceToUpgradeGatsby = true
    }
    const manifestId = `${id}-${updatedAt}-${langcode}`

    unstable_createNodeManifest({
      manifestId,
      node: gatsbyNode,
      updatedAtUTC: updatedAt,
    })
  } else if (!supportsContentSync && !warnOnceForNoSupport) {
    warnOnceForNoSupport = true
    console.warn(
      `Drupal: Your version of Gatsby core doesn't support Content Sync (via the unstable_createNodeManifest action). Please upgrade to the latest version to use Content Sync in your site.`
    )
  }
}

/**
 * この関数は、Drupal が実際のファイルノードでは返さないファイルノードの追加情報（具体的には画像の幅と高さ）を持つ Map を返す
 */
export const getExtendedFileNodeData = allData => {
  const fileNodesExtendedData = new Map()

  for (const contentType of allData) {
    if (!contentType) {
      continue
    }

    contentType.data.forEach(node => {
      if (!node) {
        return
      }

      const { relationships } = node

      if (relationships) {
        for (const relationship of Object.values<any>(relationships)) {
          const relationshipNodes = Array.isArray(relationship.data)
            ? relationship.data
            : [relationship.data]

          relationshipNodes.forEach(relationshipNode => {
            if (!relationshipNode) {
              return
            }

            if (
              relationshipNode.type === `file--file` &&
              relationshipNode.meta
            ) {
              const existingExtendedData = fileNodesExtendedData.get(
                relationshipNode.id
              )

              // このファイルノードの拡張データがすでにあれば、新しいデータをマージする必要がある
              if (existingExtendedData) {
                const existingImageDerivativeLinks =
                  existingExtendedData?.imageDerivatives?.links || {}

                const imageDerivativeLinks = {
                  ...existingImageDerivativeLinks,
                  ...(relationshipNode.meta?.imageDerivatives?.links || {}),
                }

                const newMeta = {
                  ...existingExtendedData,
                  ...relationshipNode.meta,
                }

                newMeta.imageDerivatives = {
                  ...newMeta.imageDerivatives,
                  links: imageDerivativeLinks,
                }

                fileNodesExtendedData.set(relationshipNode.id, newMeta)
              } else {
                // なければ、拡張データをそのまま Map に追加する
                fileNodesExtendedData.set(
                  relationshipNode.id,
                  relationshipNode.meta
                )
              }
            }
          })
        }
      }
    })
  }

  return fileNodesExtendedData
}
