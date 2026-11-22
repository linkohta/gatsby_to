import { getStore } from "~/store"
import { transformFields } from "./transform-fields"
import { typeIsExcluded } from "~/steps/ingest-remote-schema/is-excluded"
import {
  buildTypeName,
  filterTypeDefinition,
  getTypesThatImplementInterfaceType,
} from "./helpers"

const unionType = typeBuilderApi => {
  const { schema, type, pluginOptions } = typeBuilderApi
  const prefix = pluginOptions.schema.typePrefix

  const types = type.possibleTypes
    .filter(
      possibleType =>
        !typeIsExcluded({
          pluginOptions,
          typeName: possibleType.name,
        })
    )
    .map(possibleType => buildTypeName(possibleType.name, prefix))

  if (!types || !types.length) {
    return false
  }

  let unionType = {
    name: buildTypeName(type.name, prefix),
    types,
    resolveType: node => {
      if (node.__typename) {
        return buildTypeName(node.__typename, prefix)
      }

      return null
    },
    extensions: {
      infer: false,
    },
  }

  // @todo これをプラグインオプションとして追加する
  unionType = filterTypeDefinition(unionType, typeBuilderApi, `UNION`)

  return schema.buildUnionType(unionType)
}

const interfaceType = typeBuilderApi => {
  const { type, schema, pluginOptions } = typeBuilderApi
  const prefix = pluginOptions.schema.typePrefix

  const state = getStore().getState()
  const { ingestibles } = state.remoteSchema
  const { nodeInterfaceTypes } = ingestibles

  const implementingTypes = getTypesThatImplementInterfaceType(type)

  const transformedFields = transformFields({
    parentInterfacesImplementingTypes: implementingTypes,
    parentType: type,
    fields: type.fields,
  })

  if (!transformedFields) {
    return null
  }

  let typeDef = {
    name: buildTypeName(type.name, prefix),
    fields: transformedFields,
    extensions: { infer: false },
  }

  // これはノードのインターフェース型ではなく通常のインターフェース型なので、型名を解決する必要がある
  if (!nodeInterfaceTypes.includes(type.name)) {
    typeDef.resolveType = node =>
      node?.__typename ? buildTypeName(node.__typename, prefix) : null
  }

  typeDef = filterTypeDefinition(typeDef, typeBuilderApi, `INTERFACE`)

  return schema.buildInterfaceType(typeDef)
}

const objectType = typeBuilderApi => {
  const {
    type,
    gatsbyNodeTypes,
    fieldAliases,
    fieldBlacklist,
    schema,
    pluginOptions,
  } = typeBuilderApi

  const prefix = pluginOptions.schema.typePrefix

  const transformedFields = transformFields({
    fields: type.fields,
    parentType: type,
    gatsbyNodeTypes,
    fieldAliases,
    fieldBlacklist,
  })

  // 子フィールドがすべて除外されている場合、この型は存在すべきではない。
  // 先に null を確認する。そうしないと次のエラーになる:
  // TypeError: Cannot convert undefined or null to object at Function.keys (<anonymous>)
  // また、createSchemaCustomization のステップで wordpress のブログサイトのビルドが失敗する原因にもなる
  if (!transformedFields || !Object.keys(transformedFields).length) {
    return false
  }

  let objectType = {
    name: buildTypeName(type.name, prefix),
    fields: transformedFields,
    description: type.description,
    extensions: {
      infer: false,
    },
  }

  if (type.interfaces?.includes(`Node`)) {
    objectType.interfaces = [`Node`]
  }

  // @todo これをプラグインオプションとして追加する
  objectType = filterTypeDefinition(objectType, typeBuilderApi, `OBJECT`)

  return schema.buildObjectType(objectType)
}

const enumType = ({ schema, type, pluginOptions }) =>
  schema.buildEnumType({
    name: buildTypeName(type.name, pluginOptions.schema.typePrefix),
    values: type.enumValues.reduce((accumulator, { name }) => {
      accumulator[name] = { name }

      return accumulator
    }, {}),
    description: type.description,
  })

export default { unionType, interfaceType, objectType, enumType }
