import recursivelyTransformFields, {
  transformInlineFragments,
} from "./recursively-transform-fields"

import {
  buildNodesQueryOnFieldName,
  buildNodeQueryOnFieldName,
  buildSelectionSet,
  generateReusableFragments,
} from "./build-query-on-field-name"

import { getStore } from "~/store"
import { getTypeSettingsByType } from "~/steps/create-schema-customization/helpers"
import prettier from "prettier"
import { formatLogMessage } from "~/utils/format-log-message"
import { findNamedTypeName } from "../../create-schema-customization/helpers"

const recursivelyAliasFragments = field =>
  field.inlineFragments.map(fragment => {
    // この inlineFragments の各フィールドについて
    fragment.fields = fragment.fields.map(fragmentField => {
      if (typeof fragmentField === `string`) {
        return fragmentField
      }

      // ほかの各フラグメントの各フィールドと比較する
      let updatedFragmentField = fragmentField

      field.inlineFragments.forEach(possiblyConflictingFragment => {
        // このフラグメントを自分自身とは比較しない
        if (possiblyConflictingFragment.name === fragment.name) {
          return
        }

        possiblyConflictingFragment.fields.forEach(possiblyConflictingField => {
          const fieldNamesMatch =
            fragmentField.fieldName === possiblyConflictingField.fieldName

          const fieldTypeKindsDontMatch =
            possiblyConflictingField?.fieldType?.kind !==
            fragmentField?.fieldType?.kind

          const fieldTypeNamesDontMatch =
            possiblyConflictingField?.fieldType?.name !==
            fragmentField?.fieldType?.name

          // フィールドの名前が同じで型の kind が異なる場合は、
          // エイリアスを付ける
          if (
            fieldNamesMatch &&
            (fieldTypeKindsDontMatch || fieldTypeNamesDontMatch)
          ) {
            const autoAliasedFieldName = `${fragmentField.fieldName}__typename_${fragmentField.fieldType.name}: ${fragmentField.fieldName}`

            updatedFragmentField = {
              ...fragmentField,
              fieldName: autoAliasedFieldName,
            }

            return
          }
        })
      })
      // フィールドの名前が同じで型が異なり、かつサブフィールドを持つ場合は、フィールド名が一致するフラグメントのフィールドのサブフィールドと、それらのサブフィールドを比較する
      // サブフィールドの型が衝突していれば、エイリアスを付ける

      if (updatedFragmentField.inlineFragments) {
        updatedFragmentField.inlineFragments =
          recursivelyAliasFragments(updatedFragmentField)
      }

      return updatedFragmentField
    })

    return fragment
  })

const aliasConflictingFieldFields = field => {
  // フィールドが衝突するのは inlineFragments の中だけである
  // inlineFragments がなければ何もしない
  if (!field.inlineFragments) {
    return field
  }

  field.inlineFragments = recursivelyAliasFragments(field)

  if (field.fields) {
    field.fields = aliasConflictingFields({
      transformedFields: field.fields,
    })
  }

  return field
}

const aliasConflictingFields = ({ transformedFields }) =>
  transformedFields.map(aliasConflictingFieldFields)

const aliasConflictingFragmentFields = ({ fragments }) => {
  for (const [fragmentKey, fragment] of Object.entries(fragments)) {
    const aliasedFragment = aliasConflictingFieldFields(fragment)

    fragments[fragmentKey] = aliasedFragment
  }
}

/**
 * generateNodeQueriesFromIngestibleFields
 *
 * イントロスペクションクエリのデータを受け取り、
 * それを処理して GraphQL のクエリ文字列と情報を組み立てる
 *
 * @param {object} introspectionData
 * @returns {Object} gql のクエリ文字列を含む GraphQL のクエリ情報
 */
const generateNodeQueriesFromIngestibleFields = async () => {
  const {
    remoteSchema,
    gatsbyApi: {
      helpers: { reporter },
      pluginOptions: {
        debug: {
          graphql: { copyNodeSourcingQueryAndExit },
        },
      },
    },
  } = getStore().getState()

  const {
    fieldBlacklist,
    nodeListFilter,
    typeMap,
    ingestibles: { nodeListRootFields },
  } = remoteSchema

  const rootFields = typeMap.get(`RootQuery`).fields

  const nodeQueries = {}

  for (const { type, name } of nodeListRootFields) {
    if (fieldBlacklist.includes(name)) {
      continue
    }

    // ネストしたフィールド
    const fieldFields = typeMap.get(type.name).fields

    // ノードのリストを持つ、ネストしたフィールド
    const nodesField = fieldFields.find(nodeListFilter)

    // このクエリの型
    const nodesType = typeMap.get(findNamedTypeName(nodesField.type))

    if (!nodesType) {
      reporter.panic(
        formatLogMessage(
          `Couldn't infer node type in the remote schema from the ${name} root field.`
        )
      )
    }

    const { fields, possibleTypes } = nodesType

    const settings = getTypeSettingsByType(nodesType)

    if (settings.exclude) {
      continue
    }

    let nodeListQueries = []

    const singleNodeRootFieldInfo = rootFields.find(
      field => field.type.name === nodesType.name
    )

    if (!singleNodeRootFieldInfo) {
      // @todo ノードリストのフィールドはあるが個別のフィールドがない場合に対応する。この型ではデータの更新もプレビューもできない。
      reporter.warn(
        formatLogMessage(
          `Unable to find a single Node query for ${nodesType.name}\n\tThis type will not be available in Gatsby.\n`
        )
      )
      continue
    }

    const fragments = {}

    const singleFieldName = singleNodeRootFieldInfo?.name

    const transformedFields = recursivelyTransformFields({
      fields,
      fragments,
      parentType: type,
      mainType: type,
    })

    // WPGQL 側のノードのインターフェース型のために必要である
    transformedFields.push(`__typename`)

    let transformedInlineFragments

    if (possibleTypes) {
      transformedInlineFragments = transformInlineFragments({
        possibleTypes,
        fragments,
        parentType: nodesType,
        mainType: nodesType,
        debug: true,
        // 通常、gatsby のノードフィールドについては id だけがあればよい
        // しかしここではトップレベルにいるので、これらのフィールドを
        // クエリする必要がある
        buildGatsbyNodeFields: true,
      })

      // 衝突するインラインフラグメントのフィールドにエイリアスを付ける
      transformedInlineFragments = transformedInlineFragments.map(
        ({ fields, ...inlineFragment }) => {
          return {
            ...inlineFragment,
            fields: aliasConflictingFields({
              transformedFields: fields,
            }),
          }
        }
      )
    }

    // fragments を書き換える..
    aliasConflictingFragmentFields({ fragments })

    const aliasedTransformedFields = aliasConflictingFields({
      transformedFields,
      parentType: type,
    })

    const selectionSet = buildSelectionSet(aliasedTransformedFields, {
      fieldPath: name,
      fragments,
      transformedInlineFragments,
    })

    const builtFragments = generateReusableFragments({
      fragments,
      selectionSet,
    })

    const nodeQuery = buildNodeQueryOnFieldName({
      fields: transformedFields,
      fieldName: singleFieldName,
      settings,
      builtFragments,
      builtSelectionSet: selectionSet,
    })

    const previewQuery = buildNodeQueryOnFieldName({
      fields: transformedFields,
      fieldName: singleFieldName,
      fieldInputArguments: `id: $id, idType: ID, asPreview: true`,
      queryName: `PREVIEW_QUERY`,
      settings,
      builtFragments,
      builtSelectionSet: selectionSet,
    })

    const fieldVariables = settings.where ? `where: { ${settings.where} }` : ``

    if (
      settings.nodeListQueries &&
      typeof settings.nodeListQueries === `function`
    ) {
      const queries = settings.nodeListQueries({
        name,
        fields,
        selectionSet,
        builtFragments,
        singleFieldName,
        singleNodeRootFieldInfo,
        settings,
        store: getStore(),
        fieldVariables,
        remoteSchema,
        transformedFields,
        helpers: {
          recursivelyTransformFields,
          buildNodesQueryOnFieldName,
        },
      })

      if (queries && queries.length) {
        nodeListQueries = queries
      }
    }

    if (!nodeListQueries || !nodeListQueries.length) {
      const nodeListQuery = buildNodesQueryOnFieldName({
        fields: transformedFields,
        fieldName: name,
        fieldVariables,
        settings,
        builtFragments,
        builtSelectionSet: selectionSet,
      })

      nodeListQueries = [nodeListQuery]
    }

    if (
      process.env.NODE_ENV === `development` &&
      nodesType.name === copyNodeSourcingQueryAndExit
    ) {
      try {
        reporter.log(``)
        reporter.warn(
          formatLogMessage(
            `Query debug mode. Writing node list query for the ${nodesType.name} node type to the system clipboard and exiting\n\n`
          )
        )
        // clipboardy は ESM 専用のパッケージである
        const { default: clipboardy } = await import(`clipboardy`)
        await clipboardy.write(
          prettier.format(nodeListQueries[0], { parser: `graphql` })
        )
        process.exit()
      } catch (e) {
        reporter.log(``)
        reporter.error(e)
        reporter.log(``)
        reporter.warn(
          formatLogMessage(
            `Query debug mode failed. There was a failed attempt to copy the query for the ${nodesType.name} node type to your clipboard.\n\n`
          )
        )
        reporter.error(e)
      }
    }

    // ノードのリストまたは単一のノードを取得するための gql のクエリ文字列と、
    // この型の型情報およびプラグイン設定を持つ、
    // クエリ情報のオブジェクトを組み立てる
    nodeQueries[name] = {
      typeInfo: {
        singularName: singleFieldName,
        pluralName: name,
        nodesTypeName: nodesType.name,
      },
      nodeListQueries,
      nodeQuery,
      previewQuery,
      selectionSet,
      builtFragments,
      settings,
    }
  }

  return nodeQueries
}

export default generateNodeQueriesFromIngestibleFields
