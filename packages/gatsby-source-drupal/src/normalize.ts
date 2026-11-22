const { URL } = require(`url`)
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)
const path = require(`path`)
const { capitalize } = require(`lodash`)
const probeImageSize = require(`probe-image-size`)

import { getOptions } from "./plugin-options"

export const getHref = link => {
  if (typeof link === `object`) {
    return link.href
  }
  return link
}

export const imageCDNState = {
  foundPlaceholderStyle: false,
  hasLoggedNoPlaceholderStyle: false,
}

let four04WarningCount = 0
let corruptFileWarningCount = 0
/**
 * この関数はノードのデータを受け取り、そのノードに追加すべき Gatsby Image CDN のフィールドを返す。入力のノードが画像でなければ、空のオブジェクトを返す。
 */
const getGatsbyImageCdnFields = async ({
  node,
  type,
  pluginOptions,
  fileNodesExtendedData,
  reporter,
}) => {
  if (!pluginOptions?.skipFileDownloads || pluginOptions.imageCDN === false) {
    return {}
  }

  const isFile = isFileNode(
    {
      internal: {
        type,
      },
    },
    pluginOptions.typePrefix
  )

  if (!isFile) {
    return {}
  }

  const mimeType = node.attributes.filemime || node.attributes.mimetype
  const { filename } = node.attributes

  if (!mimeType || !filename) {
    return {}
  }

  const url = getFileUrl(node.attributes, pluginOptions.baseUrl)?.href

  if (!url) {
    return {}
  }

  if (!mimeType.includes(`image/`)) {
    return {
      mimeType,
      filename,
      url,
    }
  }

  const extraNodeData = fileNodesExtendedData?.get?.(node.id) || null

  try {
    const { placeholderStyleName } = getOptions()
    const placeholderUrl =
      extraNodeData?.imageDerivatives?.links?.[placeholderStyleName]?.href ||
      extraNodeData?.imageDerivatives?.links?.placeholder?.href ||
      url

    if (placeholderUrl !== url) {
      imageCDNState.foundPlaceholderStyle = true
    }

    const hasRequiredData = input => input && input.width && input.height

    // extraNodeData は、gatsby-node の sourceNodes で組み立てる fileNodesExtendedData の Map から取得する。この Map のデータは、ほかのノードタイプからファイルノードへの接続を調べて集めたものである。これが必要なのは、Drupal の JSON API でファイルノードを直接クエリしても、画像の幅と高さやプレースホルダーの URL が返らないためである。このデータは、ファイルノードとのリレーションシップを持つほかのノードからしか得られない。このデータがない場合は probe-image-size で画像の幅と高さを調べ、データがなくても image CDN が動くようにする。
    const imageSize = hasRequiredData(extraNodeData)
      ? extraNodeData
      : await probeImageSize(url)

    if (!hasRequiredData(imageSize) || !placeholderUrl) {
      return {}
    }

    const gatsbyImageCdnFields = {
      filename,
      url,
      placeholderUrl,
      width: imageSize.width,
      height: imageSize.height,
      mimeType,
    }

    return gatsbyImageCdnFields
  } catch (e) {
    if (e.message.includes(`404`)) {
      if (four04WarningCount < 10) {
        four04WarningCount++
        reporter.warn(`[gatsby-source-drupal] file returns 404: ${url}`)
      }

      return {}
    }

    if (e.message.includes(`unrecognized file format`)) {
      if (corruptFileWarningCount < 10) {
        corruptFileWarningCount++
        reporter.warn(
          `[gatsby-source-drupal] Encountered corrupt file while requesting image dimensions for ${url}`
        )
      }

      return {}
    }

    reporter.error(e)
    reporter.info(
      JSON.stringify(
        {
          extraNodeData,
          url,
          attributes: node.attributes,
        },
        null,
        2
      )
    )
    reporter.panicOnBuild(
      `[gatsby-source-drupal] Encountered an unrecoverable error while generating Gatsby Image CDN fields for url ${url}. See above for additional information.`
    )
  }

  return {}
}

export const generateTypeName = (type: string, typePrefix = ``) => {
  const prefixed = typePrefix
    ? `${capitalize(typePrefix)}${capitalize(type)}`
    : type

  return prefixed.replace(/-|__|:|\.|\s/g, `_`)
}

export const nodeFromData = async (
  datum,
  createNodeId,
  entityReferenceRevisions = [],
  pluginOptions,
  fileNodesExtendedData,
  reporter
) => {
  const { attributes: { id: attributeId, ...attributes } = { id: null } } =
    datum

  const preservedId =
    typeof attributeId !== `undefined` ? { _attributes_id: attributeId } : {}

  const langcode = attributes.langcode || `und`
  const { typePrefix = `` } = pluginOptions

  const type = generateTypeName(datum.type, typePrefix)

  const gatsbyImageCdnFields = await getGatsbyImageCdnFields({
    node: datum,
    type,
    pluginOptions,
    fileNodesExtendedData,
    reporter,
  })

  const versionedId = createNodeIdWithVersion({
    id: datum.id,
    type: datum.type,
    langcode,
    revisionId: attributes.drupal_internal__revision_id,
    entityReferenceRevisions,
    typePrefix,
  })

  const gatsbyId = createNodeId(versionedId)

  return {
    id: gatsbyId,
    drupal_id: datum.id,
    parent: null,
    drupal_parent_menu_item: attributes.parent,
    children: [],
    ...attributes,
    ...preservedId,
    ...gatsbyImageCdnFields,
    drupal_relationships: datum.relationships,
    relationships: {},
    internal: {
      type,
    },
  }
}

const isEntityReferenceRevision = (
  type,
  entityReferenceRevisions: Array<string> = []
) =>
  entityReferenceRevisions.findIndex(
    revisionType => type.indexOf(revisionType) === 0
  ) !== -1

export const createNodeIdWithVersion = ({
  id,
  type,
  langcode,
  revisionId,
  entityReferenceRevisions = [],
  typePrefix,
}: {
  id: string
  type: string
  langcode: string
  revisionId: string
  entityReferenceRevisions: Array<string>
  typePrefix: string
}) => {
  const options = getOptions()

  // 翻訳されないエンティティでは、デフォルト言語にフォールバックする。
  if (
    options?.languageConfig?.nonTranslatableEntities?.includes(type) &&
    options.languageConfig.defaultLanguage
  ) {
    langcode = options.languageConfig.defaultLanguage
  }

  // ソースプラグインで `translation` が有効になっていない場合は、langcode を常に
  // "undefined" に設定する。
  let langcodeNormalized = options.languageConfig ? langcode : `und`

  const renamedCode = options?.languageConfig?.renamedEnabledLanguages?.find(
    lang => lang.langCode === langcodeNormalized
  )

  if (renamedCode) {
    langcodeNormalized = renamedCode.as
  }

  if (
    !renamedCode &&
    options.languageConfig &&
    options.languageConfig.defaultLanguage &&
    !options?.languageConfig?.enabledLanguages?.includes(langcodeNormalized)
  ) {
    langcodeNormalized = options.languageConfig.defaultLanguage
  }

  const isReferenceRevision = isEntityReferenceRevision(
    type,
    entityReferenceRevisions
  )

  // フィールドの型が、paragraphs などで使われる entity reference revision の場合、
  // エンティティ同士のリレーションシップはリビジョン ID にも依存する。
  const idVersion = isReferenceRevision
    ? `${langcodeNormalized}.${id}.${revisionId || 0}`
    : `${langcodeNormalized}.${id}`

  return typePrefix ? `${typePrefix}.${idVersion}` : idVersion
}

const fileNodeTypes = new Map<string, Set<string>>()

export const isFileNode = (node, typePrefix = ``) => {
  if (!fileNodeTypes.has(typePrefix)) {
    fileNodeTypes.set(
      typePrefix,
      new Set<string>([
        generateTypeName(`files`, typePrefix),
        generateTypeName(`file--file`, typePrefix),
      ])
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return fileNodeTypes.get(typePrefix)!.has(node?.internal?.type)
}

const getFileUrl = (node, baseUrl) => {
  let fileUrl = node.url

  if (typeof node.uri === `object`) {
    // JSON API 2.x のファイル URI の形式に対応する https://www.drupal.org/node/2982209
    fileUrl = node.uri.url
  }

  // node.uri が絶対 URL でなければ、baseUrl を基準に解決する。
  const url = new URL(fileUrl, baseUrl)

  return url
}

export const downloadFile = async (
  { node, cache, createNode, createNodeId, getCache },
  { basicAuth, baseUrl, typePrefix }: Record<string, any>
) => {
  // ファイルのダウンロードを処理する
  if (!isFileNode(node, typePrefix)) {
    return
  }
  let fileType

  if (typeof node.uri === `object`) {
    // URI の接頭辞（"S3:"、"public:" など）からファイルの種類を取得する
    const uriPrefix = node.uri.value.match(/^\w*:/)
    fileType = uriPrefix ? uriPrefix[0] : null
  }

  const url = getFileUrl(node, baseUrl)

  // basicAuth の認証情報があれば、リクエストに追加する。
  const basicAuthFileSystems = [`public:`, `private:`, `temporary:`]
  const auth =
    typeof basicAuth === `object` && basicAuthFileSystems.includes(fileType)
      ? {
          htaccess_user: basicAuth.username,
          htaccess_pass: basicAuth.password,
        }
      : {}
  const fileNode = await createRemoteFileNode({
    url: url.href,
    name: path.parse(decodeURIComponent(url.pathname)).name,
    cache,
    createNode,
    createNodeId,
    getCache,
    parentNodeId: node.id,
    auth,
  })
  if (fileNode) {
    node.localFile___NODE = fileNode.id
  }
}
