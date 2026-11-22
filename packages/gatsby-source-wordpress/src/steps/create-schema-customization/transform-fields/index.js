import { getFieldTransformers } from "./field-transformers"
import { getGatsbyNodeTypeNames } from "../../source-nodes/fetch-nodes/fetch-nodes"
import { getStore } from "~/store"
import { getPluginOptions } from "~/utils/get-gatsby-api"

import {
  fieldOfTypeWasFetched,
  typeIsASupportedScalar,
  getTypeSettingsByType,
  findNamedTypeName,
} from "../helpers"

import { buildDefaultResolver } from "./default-resolver"

/**
 * @param {import("graphql").GraphQLField} field
 */

const handleCustomScalars = field => {
  const fieldTypeIsACustomScalar =
    field.type.kind === `SCALAR` && !typeIsASupportedScalar(field.type)

  if (fieldTypeIsACustomScalar) {
    // このフィールドが未対応のカスタムスカラーであれば、
    // JSON として型付けする
    return {
      ...field,
      type: {
        ...field.type,
        name: `JSON`,
      },
    }
  }

  const fieldTypeOfTypeIsACustomScalar =
    field.type.ofType?.kind === `SCALAR` && !typeIsASupportedScalar(field.type)

  if (fieldTypeOfTypeIsACustomScalar) {
    // このフィールドが未対応のカスタムスカラーであれば、
    // JSON として型付けする
    return {
      ...field,
      type: {
        ...field.type,
        ofType: {
          ...field.type.ofType,
          name: `JSON`,
        },
      },
    }
  }

  return field
}

// これは、Gatsby のノードフィールドと衝突するフィールドにエイリアスを付けるために使う
// たとえば、Gatsby と WPGQL はどちらも `parent` フィールドを持つ
export const getAliasedFieldName = ({ fieldAliases, field }) =>
  fieldAliases && fieldAliases[field.name]
    ? fieldAliases[field.name]
    : field.name

export const returnAliasedFieldName = ({ fieldAliases, field }) =>
  fieldAliases && fieldAliases[field.name]
    ? `${fieldAliases[field.name]}: ${field.name}`
    : field.name

const fieldIsExcluded = ({
  field,
  fieldName,
  thisTypeSettings,
  fieldBlacklist,
  parentTypeSettings,
  parentInterfacesImplementingTypeSettings,
}) =>
  // このフィールドは以前に取得されていないので、
  // スキーマに追加すべきではない
  (!fieldOfTypeWasFetched(field.type) && fieldName !== `id`) ||
  // このフィールドは、親フィールドの型で除外されている
  (parentTypeSettings.excludeFieldNames &&
    parentTypeSettings.excludeFieldNames.includes(fieldName)) ||
  // このフィールドはインターフェース型にあり、それを実装する型のいずれかでこのフィールドが除外されている。
  (parentInterfacesImplementingTypeSettings &&
    parentInterfacesImplementingTypeSettings.find(
      typeSetting =>
        typeSetting.excludeFieldNames &&
        typeSetting.excludeFieldNames.find(
          excludedFieldName => fieldName === excludedFieldName
        )
    )) ||
  // このフィールドの型は、プラグインオプションで除外されている
  thisTypeSettings.exclude ||
  // フィールドがブラックリストに入っている
  fieldBlacklist.includes(fieldName) ||
  // このフィールドには必須の入力引数がある
  (field.args && field.args.find(arg => arg.type.kind === `NON_NULL`)) ||
  // このフィールドには typeName がない
  !findNamedTypeName(field.type)

/**
 * WPGQL スキーマのフィールドを、ノードのリンクと型の名前空間を正しく保ったまま
 * Gatsby のスキーマで動くように変換する
 * 使えないフィールドと型の除外も行う
 */
export const transformFields = ({
  fields,
  parentType,
  parentInterfacesImplementingTypes,
  peek = false,
}) => {
  if (!fields || !fields.length) {
    return null
  }

  const gatsbyNodeTypes = getGatsbyNodeTypeNames()

  const { fieldAliases, fieldBlacklist } = getStore().getState().remoteSchema

  const parentTypeSettings = getTypeSettingsByType(parentType)

  const parentInterfacesImplementingTypeSettings =
    parentInterfacesImplementingTypes
      ? parentInterfacesImplementingTypes.map(type =>
          getTypeSettingsByType(type)
        )
      : null

  const transformedFields = fields.reduce((fieldsObject, field) => {
    // フィールド名がなければ、このフィールドは使えない
    if (field.name === ``) {
      return fieldsObject
    }

    const thisTypeSettings = getTypeSettingsByType(field.type)

    const fieldName = getAliasedFieldName({ fieldAliases, field })

    if (
      fieldIsExcluded({
        field,
        fieldName,
        thisTypeSettings,
        fieldBlacklist,
        parentTypeSettings,
        parentInterfacesImplementingTypeSettings,
      })
    ) {
      return fieldsObject
    }

    const { typeMap } = getStore().getState().remoteSchema

    const type = typeMap.get(findNamedTypeName(field.type))

    const includedChildFields = type?.fields?.filter(field => {
      const childFieldTypeSettings = getTypeSettingsByType(field.type)
      const fieldName = getAliasedFieldName({ fieldAliases, field })
      return !fieldIsExcluded({
        field,
        fieldName,
        thisTypeSettings: childFieldTypeSettings,
        fieldBlacklist,
        parentTypeSettings: thisTypeSettings,
        parentInterfacesImplementingTypeSettings,
      })
    })

    // このフィールドの子フィールドがすべて除外されている場合、
    // このフィールドは追加すべきではない
    // @todo これを 1 か所にまとめる。
    // 除外によって子フィールドをすべて失った型は、
    // 自動的にグローバルで除外されるべきである。
    if (Array.isArray(includedChildFields) && !includedChildFields.length) {
      return fieldsObject
    }

    field = handleCustomScalars(field)

    const { transform, description } =
      peek === false
        ? getFieldTransformers().find(({ test }) => test(field)) || {}
        : {}

    if (transform && typeof transform === `function` && peek === false) {
      const transformerApi = {
        field,
        fieldsObject,
        fieldName,
        gatsbyNodeTypes,
        description,
        pluginOptions: getPluginOptions(),
      }

      let transformedField = transform(transformerApi)

      // デフォルトのリゾルバーを追加する
      if (typeof transformedField === `string`) {
        // デフォルトのリゾルバーを上書きし、エイリアス付きのフィールドを確認するために、
        // カスタムリゾルバーを追加する必要がある
        // 同じユニオン型またはインターフェース型の上で inlineFragments を
        // 並べたときに、同じ名前のほかのフィールドと型が衝突するフィールドには、
        // 自動的にエイリアスが付く。
        transformedField = {
          type: transformedField,
          resolve: buildDefaultResolver(transformerApi),
          description: field.description,
        }
      } else {
        transformedField.description = field.description
      }

      fieldsObject[fieldName] = transformedField
    } else if (peek) {
      fieldsObject[fieldName] = true
    }

    return fieldsObject
  }, {})

  if (!Object.keys(transformedFields).length) {
    return null
  }

  return transformedFields
}
