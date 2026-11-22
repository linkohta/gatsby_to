import { getStore } from "~/store"
import {
  getTypeSettingsByType,
  findNamedTypeName,
  findTypeKind,
} from "~/steps/create-schema-customization/helpers"
import {
  fieldIsExcludedOnParentType,
  fieldIsExcludedOnAll,
} from "~/steps/ingest-remote-schema/is-excluded"
import { returnAliasedFieldName } from "~/steps/create-schema-customization/transform-fields"
import { typeIsExcluded } from "../is-excluded"

export const transformInlineFragments = ({
  possibleTypes,
  gatsbyNodesInfo,
  typeMap,
  maxDepth,
  parentType,
  mainType,
  parentField,
  fragments,
  circularQueryLimit,
  buildGatsbyNodeFields = false,
  depth = 0,
  buildingFragment = false,
  ancestorTypeNames: parentAncestorTypeNames = [],
}) => {
  const state = getStore().getState()

  if (!typeMap) {
    typeMap = state.remoteSchema.typeMap
  }

  const { pluginOptions } = state.gatsbyApi

  if (!maxDepth) {
    maxDepth = pluginOptions.schema.queryDepth
  }

  if (!circularQueryLimit) {
    circularQueryLimit = pluginOptions.circularQueryLimit
  }

  if (!gatsbyNodesInfo) {
    gatsbyNodesInfo = state.remoteSchema.gatsbyNodesInfo
  }

  const ancestorTypeNames = [...parentAncestorTypeNames]

  const transformedInlineFragments = possibleTypes
    .map(possibleType => {
      possibleType = { ...possibleType }

      const type = typeMap.get(possibleType.name)

      if (!type) {
        return false
      }

      const typeSettings = getTypeSettingsByType(type)

      if (typeSettings.exclude) {
        return false
      }

      if (
        typeIsExcluded({
          pluginOptions,
          typeName: findNamedTypeName(type),
        })
      ) {
        return false
      }

      possibleType.type = { ...type }

      // スキーマのカスタマイズで使えるよう、この型を保存する
      getStore().dispatch.remoteSchema.addFetchedType(type)

      const isAGatsbyNode = gatsbyNodesInfo.typeNames.includes(
        possibleType.name
      )

      if (isAGatsbyNode && !buildGatsbyNodeFields) {
        // トップレベルの Gatsby ノードへのリンクには id を使う
        possibleType.fields = [`id`]
        return possibleType
      }

      const typeInfo = typeMap.get(possibleType.name)

      let filteredFields = [...typeInfo.fields]

      if (parentType?.kind === `INTERFACE`) {
        // 親の型がすでに共通フィールドとして持っているフィールドは、フラグメントから取り除く
        filteredFields = filteredFields.filter(
          filteredField =>
            !parentType.fields.find(
              parentField => parentField.name === filteredField.name
            )
        )
      }

      if (typeInfo) {
        const fields = recursivelyTransformFields({
          fields: filteredFields,
          parentType: type,
          depth,
          ancestorTypeNames,
          fragments,
          buildingFragment,
          circularQueryLimit,
          mainType,
          parentField,
        })

        if (!fields || !fields.length) {
          return false
        }

        possibleType.fields = [...fields]
        return possibleType
      }

      return false
    })
    .filter(Boolean)

  return possibleTypes && depth <= maxDepth ? transformedInlineFragments : null
}

// 何階層も上のフィールドにあるかもしれない循環する型を数えているので、ここでは incarnation（化身）という言葉が合うと感じた ;) 型は後の世代で生まれ変わる
const countIncarnations = ({ typeName, ancestorTypeNames }) =>
  ancestorTypeNames.length
    ? ancestorTypeNames.filter(
        ancestorTypeName => ancestorTypeName === typeName
      )?.length
    : 0

export function transformField({
  field,
  gatsbyNodesInfo,
  typeMap,
  maxDepth,
  depth,
  fieldBlacklist,
  fieldAliases,
  ancestorTypeNames: parentAncestorTypeNames,
  circularQueryLimit,
  fragments,
  buildingFragment,
  mainType,
} = {}) {
  const ancestorTypeNames = [...parentAncestorTypeNames]

  // フィールドがほかの型につながり、その型のフィールドがさらにほかの型へのコネクションになっていると、無限に再帰する可能性がある
  //  そのため、上限が必要である
  if (depth > maxDepth) {
    return false
  }

  depth++

  // フィールドに型がなければ使えない。
  if (!field || !field.type) {
    return false
  }

  const typeSettings = getTypeSettingsByType(field.type)

  if (typeSettings.exclude) {
    return false
  }

  // この型が、ツリーの上のどこかで自分自身の祖先として
  // 現れた回数を数える
  const typeName = findNamedTypeName(field.type)
  const typeKind = findTypeKind(field.type)

  const typeIncarnationCount = countIncarnations({
    typeName,
    ancestorTypeNames,
  })

  if (typeIncarnationCount > 0) {
    // この型は、少なくとも 1 回は自分自身の中にネストしている
    // ここで再利用できるフラグメントを作成する
    createFragment({
      fields: typeMap.get(typeName).fields,
      type: field.type,
      fragments,
      field,
      ancestorTypeNames: parentAncestorTypeNames,
      depth,
      fieldBlacklist,
      fieldAliases,
      typeMap,
      gatsbyNodesInfo,
      circularQueryLimit,
      queryDepth: maxDepth,
      buildingFragment,
      mainType,
    })
  }

  if (typeIncarnationCount >= circularQueryLimit) {
    return false
  }

  // これは、Gatsby のノードフィールドと衝突するフィールドにエイリアスを付けるために使う
  // たとえば、Gatsby と WPGQL はどちらも `parent` フィールドを持つ
  const fieldName = returnAliasedFieldName({ fieldAliases, field })

  if (
    fieldBlacklist.includes(field.name) ||
    fieldBlacklist.includes(fieldName)
  ) {
    return false
  }

  // 必須の引数を持つフィールドを取り除く。引数を省略するとクエリエラーになり、
  //  その引数の使い方をプログラムから判断することもできない。
  if (
    field.args &&
    field.args.length &&
    field.args.find(arg => arg?.type?.kind === `NON_NULL`)
  ) {
    return false
  }

  const fieldType = typeMap.get(findNamedTypeName(field.type)) || {}
  const ofType = typeMap.get(findNamedTypeName(fieldType.ofType)) || {}

  if (
    fieldType.kind === `SCALAR` ||
    fieldType.kind === `ENUM` ||
    (fieldType.kind === `NON_NULL` && ofType.kind === `SCALAR`) ||
    (fieldType.kind === `LIST` && fieldType.ofType.kind === `SCALAR`) ||
    // enum のリストには型名がないので、上の findNamedTypeName はフィールドの型ではなく
    // enum の型を見つける。ヘルパーを使わずに、ここで明示的に
    // 確認する必要がある
    (field.type.kind === `LIST` && field.type?.ofType?.kind === `ENUM`)
  ) {
    return {
      fieldName,
      fieldType,
    }
  }

  const isListOfGatsbyNodes =
    ofType && gatsbyNodesInfo.typeNames.includes(typeName)

  const isListOfMediaItems = ofType && typeName === `MediaItem`

  const hasIdField = fieldType?.fields?.find(({ name }) => name === `id`)
  if (
    fieldType.kind === `LIST` &&
    isListOfGatsbyNodes &&
    !isListOfMediaItems &&
    hasIdField
  ) {
    return {
      fieldName: fieldName,
      fields: [`__typename`, `id`],
      fieldType,
    }
  } else if (fieldType.kind === `LIST` && isListOfMediaItems && hasIdField) {
    return {
      fieldName: fieldName,
      fields: [`__typename`, `id`],
      fieldType,
    }
  } else if (fieldType.kind === `LIST`) {
    const listOfType = typeMap.get(findNamedTypeName(fieldType))

    const transformedFields = recursivelyTransformFields({
      fields: listOfType.fields,
      parentType: listOfType || fieldType,
      depth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
      mainType,
    })

    const transformedInlineFragments = transformInlineFragments({
      possibleTypes: listOfType.possibleTypes,
      parentType: listOfType || fieldType,
      parentField: field,
      mainType,
      gatsbyNodesInfo,
      typeMap,
      depth,
      maxDepth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    if (!transformedFields?.length && !transformedInlineFragments?.length) {
      return false
    }

    // inlineFragments か fields のどちらかがある場合
    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments: transformedInlineFragments,
      fieldType,
    }
  }

  const isAGatsbyNode =
    // これが gatsby のノードタイプである場合
    gatsbyNodesInfo.typeNames.includes(typeName) ||
    // または、この型が取り得るすべての型が Gatsby のノードタイプである場合
    typeMap
      .get(typeName)
      ?.possibleTypes?.every(possibleType =>
        gatsbyNodesInfo.typeNames.includes(possibleType.name)
      )

  if (isAGatsbyNode && hasIdField) {
    return {
      fieldName: fieldName,
      fields: [`__typename`, `id`],
      fieldType,
    }
  }

  const typeInfo = typeMap.get(findNamedTypeName(fieldType))

  const { fields } = typeInfo || {}

  let transformedInlineFragments

  if (typeInfo.possibleTypes) {
    transformedInlineFragments = transformInlineFragments({
      possibleTypes: typeInfo.possibleTypes,
      parentType: typeInfo,
      parentField: field,
      mainType,
      gatsbyNodesInfo,
      typeMap,
      depth,
      maxDepth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })
  }

  if (fields || transformedInlineFragments) {
    const transformedFields = recursivelyTransformFields({
      parentType: typeInfo,
      parentFieldName: field.name,
      mainType,
      fields,
      depth,
      ancestorTypeNames,
      parentField: field,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    if (!transformedFields?.length && !transformedInlineFragments?.length) {
      return false
    }

    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments: transformedInlineFragments,
      fieldType,
    }
  }

  if (fieldType.kind === `UNION`) {
    const typeInfo = typeMap.get(fieldType.name)

    const transformedFields = recursivelyTransformFields({
      fields: typeInfo.fields,
      parentType: fieldType,
      mainType,
      depth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    const inlineFragments = transformInlineFragments({
      possibleTypes: typeInfo.possibleTypes,
      gatsbyNodesInfo,
      typeMap,
      mainType,
      depth,
      maxDepth,
      ancestorTypeNames,
      parentField: field,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments,
      fieldType,
    }
  }

  return false
}

const createFragment = ({
  fields,
  field,
  type,
  fragments,
  fieldBlacklist,
  fieldAliases,
  typeMap,
  gatsbyNodesInfo,
  queryDepth,
  ancestorTypeNames,
  mainType,
  buildingFragment = false,
}) => {
  const typeName = findNamedTypeName(type)

  if (buildingFragment) {
    // このフラグメントは、すでに組み立て中のフラグメントの中にあるので、抜ける
    return null
  }

  const previouslyCreatedFragment = fragments?.[typeName]

  if (previouslyCreatedFragment && buildingFragment === typeName) {
    return previouslyCreatedFragment
  }

  const fragmentFields = fields.reduce((fragmentFields, field) => {
    const fieldTypeName = findNamedTypeName(field.type)
    const fieldType = typeMap.get(fieldTypeName)

    if (
      // このフィールドがフラグメントとは別の型で、フラグメントと同じ型のフィールドを持つ場合は、
      // この型が 1 階層下で自分自身の中にネストしないよう、フラグメント内のこのフィールドをスキップする必要がある
      fieldType.name !== typeName &&
      fieldType?.fields?.find(
        innerFieldField => findNamedTypeName(innerFieldField.type) === typeName
      )
    ) {
      return fragmentFields
    }

    const transformedField = transformField({
      field,
      gatsbyNodesInfo,
      typeMap,
      maxDepth: queryDepth,
      depth: 0,
      fieldBlacklist,
      fieldAliases,
      ancestorTypeNames,
      mainType,
      circularQueryLimit: 1,
      fragments,
      buildingFragment: typeName,
    })

    if (findNamedTypeName(field.type) !== typeName && !!transformedField) {
      fragmentFields.push(transformedField)
    }

    return fragmentFields
  }, [])

  const queryType = typeMap.get(typeName)

  const transformedInlineFragments = queryType?.possibleTypes?.length
    ? transformInlineFragments({
        possibleTypes: queryType.possibleTypes,
        parentType: queryType,
        parentField: field,
        mainType,
        gatsbyNodesInfo,
        typeMap,
        depth: 0,
        maxDepth: queryDepth,
        circularQueryLimit: 1,
        ancestorTypeNames,
        fragments,
        buildingFragment: typeName,
      })
    : null

  if (fragments) {
    fragments[typeName] = {
      name: `${typeName}Fragment`,
      type: typeName,
      fields: fragmentFields,
      inlineFragments: transformedInlineFragments,
    }
  }

  return fragmentFields
}

const transformFields = ({
  fields,
  parentType,
  mainType,
  fragments,
  parentField,
  ancestorTypeNames,
  depth,
  fieldBlacklist,
  fieldAliases,
  typeMap,
  gatsbyNodesInfo,
  queryDepth,
  circularQueryLimit,
  pluginOptions,
  buildingFragment,
}) =>
  fields
    ?.filter(
      field =>
        !fieldIsExcludedOnParentType({
          field,
          parentType,
        }) &&
        !fieldIsExcludedOnAll({
          pluginOptions,
          field,
        }) &&
        !typeIsExcluded({
          pluginOptions,
          typeName: findNamedTypeName(field.type),
        })
    )
    .map(field => {
      const transformedField = transformField({
        maxDepth: queryDepth,
        gatsbyNodesInfo,
        fieldBlacklist,
        fieldAliases,
        typeMap,
        field,
        depth,
        ancestorTypeNames,
        circularQueryLimit,
        fragments,
        buildingFragment,
        mainType,
        parentField,
      })

      if (transformedField) {
        // スキーマのカスタマイズで使うことが分かるよう、この型を保存する
        getStore().dispatch.remoteSchema.addFetchedType(field.type)
      }

      const typeName = findNamedTypeName(field.type)
      const fragment = fragments?.[typeName]

      // @todo 隣接するフィールドとインラインフラグメントを、保存するフラグメントのオブジェクトに直接追加し、このロジックを if (fragment) useTheFragment() に変えられるようにする
      // それができれば、上の transformField() の前後に追加でき ☝️
      // どのみち捨てられるコストの高い処理を省ける可能性がある
      if (fragment && transformedField && buildingFragment !== typeName) {
        // if (fragment && buildingFragment !== typeName && transformedField) {
        // フラグメントにすでに存在するフィールドを、このクエリから取り除く
        if (transformedField?.fields?.length) {
          transformedField.fields = transformedField.fields.filter(
            field =>
              !fragment.fields.find(
                fragmentField => fragmentField.fieldName === field.fieldName
              )
          )
        }

        // このフィールドにフィールドがない場合（インラインフラグメントしかないため）は、
        // 空の配列を作る必要がある。再利用可能なフラグメントをフィールドとして
        // 扱っているためである
        if (!transformedField.fields) {
          transformedField.fields = []
        }

        transformedField.fields.push({
          internalType: `Fragment`,
          fragment,
        })

        if (transformedField?.inlineFragments?.length) {
          transformedField.inlineFragments =
            transformedField.inlineFragments.filter(
              fieldInlineFragment =>
                // これが .find() のひどい使い方であることは承知している。@todo パフォーマンス改善のためにリファクタリングする
                !fragment.inlineFragments.find(
                  fragmentInlineFragment =>
                    fragmentInlineFragment.name === fieldInlineFragment.name
                )
            )
        }
      }

      if (field.fields && !transformedField) {
        return null
      }

      const fieldTypeKind = findTypeKind(field.type)
      const fieldOfTypeKind = findTypeKind(field.type.ofType)
      const typeKindsRequiringSelectionSets = [`OBJECT`, `UNION`, `INTERFACE`]
      const fieldNeedsSelectionSet =
        typeKindsRequiringSelectionSets.includes(fieldTypeKind) ||
        typeKindsRequiringSelectionSets.includes(fieldOfTypeKind)

      if (
        // フィールドにセレクションセットが必要で
        fieldNeedsSelectionSet &&
        // かつ、フィールドがなく
        !transformedField.fields &&
        // かつ、インラインフラグメントもない場合
        !transformedField.inlineFragments
      ) {
        // GraphQL のエラーを防ぐため、このフィールドを破棄する必要がある
        // おそらくクエリの深さの最下層にいるので、
        // このフィールドの子が省略されている
        return null
      }

      return transformedField
    })
    .filter(Boolean)

const recursivelyTransformFields = ({
  fields,
  parentType,
  mainType,
  fragments,
  parentField,
  ancestorTypeNames: parentAncestorTypeNames,
  depth = 0,
  buildingFragment = false,
}) => {
  if (!fields || !fields.length) {
    return null
  }

  if (!parentAncestorTypeNames) {
    parentAncestorTypeNames = []
  }

  const ancestorTypeNames = [...parentAncestorTypeNames]

  const {
    gatsbyApi: { pluginOptions },
    remoteSchema: { fieldBlacklist, fieldAliases, typeMap, gatsbyNodesInfo },
  } = getStore().getState()

  const {
    schema: { queryDepth, circularQueryLimit },
  } = pluginOptions

  if (depth > queryDepth && ancestorTypeNames.length) {
    return null
  }

  const typeName = findNamedTypeName(parentType)

  const grandParentTypeName = ancestorTypeNames.length
    ? ancestorTypeNames[ancestorTypeNames.length - 1]
    : null

  if (grandParentTypeName && typeName !== grandParentTypeName) {
    // フィールドが、その上のフィールドと同じ型のフィールドを持つ場合は、
    // それらを取得すべきではない。互いに循環する 2 つの型は、
    // 非常に大きなクエリを生成し、不要なデータを取得してしまうので危険である
    // こうした型は本来、適切なコネクションであるべきで、そうすれば
    // id だけを取得すればよいと判断できる。
    // @todo これをここではなく transformFields() へ移すことを検討する
    fields = fields.filter(field => {
      const fieldTypeName = findNamedTypeName(field.type)
      return fieldTypeName !== grandParentTypeName
    })
  }

  const typeIncarnationCount = countIncarnations({
    typeName,
    ancestorTypeNames,
  })

  if (typeIncarnationCount >= circularQueryLimit) {
    return null
  }

  parentAncestorTypeNames.push(typeName)

  const recursivelyTransformedFields = transformFields({
    fields,
    parentType,
    mainType,
    fragments,
    parentField,
    ancestorTypeNames: parentAncestorTypeNames,
    depth,
    fieldBlacklist,
    fieldAliases,
    typeMap,
    gatsbyNodesInfo,
    queryDepth,
    circularQueryLimit,
    pluginOptions,
    buildingFragment,
  })

  if (!recursivelyTransformedFields.length) {
    return null
  }

  return recursivelyTransformedFields
}

export default recursivelyTransformFields
