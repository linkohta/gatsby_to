import { getStore, withPluginKey } from "~/store"
import { typeDefinitionFilters } from "./type-filters"
import { getPluginOptions } from "~/utils/get-gatsby-api"
import { cloneDeep, merge } from "lodash"
import { diffString } from "json-diff"
import { formatLogMessage } from "../../utils/format-log-message"
import { CODES } from "../../utils/report"

export const buildInterfacesListForType = type => {
  let shouldAddNodeType = false

  const list = (type?.interfaces || [])
    .filter(interfaceType => {
      const interfaceTypeSettings = getTypeSettingsByType(interfaceType)

      return (
        !interfaceTypeSettings.exclude && fieldOfTypeWasFetched(interfaceType)
      )
    })
    .map(({ name }) => {
      if (name === `Node`) {
        shouldAddNodeType = true
      }
      return buildTypeName(name)
    })

  if (shouldAddNodeType) {
    list.push(`Node`)
  }

  return list
}

let ceIntCache = null
const isWpgqlOneThirteenZeroPlus = () => {
  if (ceIntCache !== null) {
    return ceIntCache
  }

  const { typeMap } = getStore().getState().remoteSchema

  const connectionInterface = !!typeMap.get(`Connection`)
  const edgeInterface = !!typeMap.get(`Edge`)

  const isWpgqlOneThirteenZeroPlus = connectionInterface || edgeInterface

  ceIntCache = isWpgqlOneThirteenZeroPlus

  return isWpgqlOneThirteenZeroPlus
}

/**
 * この関数は、型名に接頭辞を付けて名前空間を分ける
 */
export const buildTypeName = (name, prefix) => {
  if (!name || typeof name !== `string`) {
    return null
  }

  if (!prefix) {
    prefix = getPluginOptions().schema.typePrefix
  }

  // これは、ルートにある名前空間用の型 { wp { ...fields } } のためのものである
  if (name === prefix) {
    return name
  }

  // Gatsby も同じ型を作るので、衝突を避けるために名前を変更する必要がある
  if (name === `Filter`) {
    name = `FilterType`
  }

  if (
    // WPGraphQL 1.13.0 以降では、Gatsby と WPGraphQL の両方が、スキーマ内のすべてのノードタイプについて、これらの文字列で終わる型を生成する。そのため、衝突を避けるために型の名前を変更する必要がある。
    // 古いバージョンの WPGraphQL を使っているユーザーについては、スキーマを以前のままに保つようにすべきである
    isWpgqlOneThirteenZeroPlus() &&
    (name.endsWith(`Connection`) ||
      name.endsWith(`Edge`) ||
      name.endsWith(`PageInfo`))
  ) {
    name += `Type`
  }

  if (name.startsWith(prefix)) {
    return name
  }

  return prefix + name
}

/**
 * イントロスペクションで取得した型定義から、最初の型の kind を探す
 * @param {object} type
 */
export const findTypeKind = type => {
  if (type?.kind) {
    return type.kind
  }

  if (type?.ofType) {
    return findTypeKind(type.ofType)
  }

  return null
}

export const findNamedType = type => {
  if (!type) {
    return null
  }

  if (type.ofType) {
    return findNamedType(type.ofType)
  }

  return type
}

export const findNamedTypeName = type => {
  const namedType = findNamedType(type)

  return namedType?.name
}

export const fieldOfTypeWasFetched = type => {
  const { fetchedTypes } = getStore().getState().remoteSchema
  const typeName = findNamedTypeName(type)
  const typeWasFetched = !!fetchedTypes.get(typeName)

  return typeWasFetched
}

const implementingTypeCache = new Map()

export const getTypesThatImplementInterfaceType = type => {
  if (implementingTypeCache.has(type.name)) {
    return implementingTypeCache.get(type.name)
  }

  const state = getStore().getState()
  const { typeMap } = state.remoteSchema

  const allTypes = typeMap.values()

  const implementingTypes = Array.from(allTypes)
    .filter(
      ({ interfaces }) =>
        interfaces &&
        // このインターフェース型を実装している型を探す
        interfaces.find(singleInterface => singleInterface.name === type.name)
    )
    .map(type => typeMap.get(type.name))
    .filter(
      type =>
        type.kind !== `UNION` ||
        // ユニオン型の場合は、メンバー型が 1 つ以上あることを確認する。そうでないと、スキーマのカスタマイズでエラーになる
        (!!type.possibleTypes && !!type.possibleTypes.length)
    )

  implementingTypeCache.set(type.name, implementingTypes)

  return implementingTypes
}

const supportedScalars = [
  `Int`,
  `Float`,
  `String`,
  `Boolean`,
  `ID`,
  `Date`,
  `JSON`,
]

export const typeIsABuiltInScalar = type =>
  // @todo 次の関数とこの関数は重複している。
  // この問題の直し方は次の todo を参照。その todo が解決すれば、これらの関数はまったく同じになる。:(
  supportedScalars.includes(findNamedTypeName(type))

export const typeIsASupportedScalar = type => {
  if (findTypeKind(type) !== `SCALAR`) {
    // @todo ここで true を返すのは誤りに見える。スカラーではない型が対応済みのスカラーであるはずがないためである... つまり、ほかのどこかのロジックが誤っている
    // ここで false を返すようにすると、スキーマでエラーが起きる
    return true
  }

  return supportedScalars.includes(findNamedTypeName(type))
}

const typeSettingCache = new Map()

// 指定した型のプラグイン設定を取得する
export const getTypeSettingsByType = type => {
  if (!type) {
    return {}
  }

  const typeName = findNamedTypeName(type)

  if (!typeName) {
    return {}
  }

  const cachedTypeSettings = typeSettingCache.get(typeName)

  if (cachedTypeSettings) {
    return cachedTypeSettings
  }

  // すべての型の設定を持つ、プラグインオプションのオブジェクト
  const allTypeSettings = getStore().getState().gatsbyApi.pluginOptions.type

  const typeSettings = cloneDeep(allTypeSettings[typeName] || {})

  // すべての型の設定に適用される、プラグインオプションの type.__all
  const __allTypeSetting = cloneDeep(allTypeSettings.__all || {})

  if (typeName === `MediaItem`) {
    delete __allTypeSetting.limit
    delete typeSettings.limit
  }

  if (typeSettings) {
    const mergedSettings = merge(__allTypeSetting, typeSettings)

    typeSettingCache.set(typeName, mergedSettings)

    return mergedSettings
  }

  typeSettingCache.set(typeName, __allTypeSetting)

  return __allTypeSetting
}

/**
 * これは、自動生成された型定義をスキーマカスタマイズの API に追加する前に、フィルターをかけるために使う。
 */
export const filterTypeDefinition = (
  typeDefinition,
  typeBuilderApi,
  typeKind
) => {
  const filters = typeDefinitionFilters.filter(filter =>
    [typeBuilderApi.type.name, `__all`].includes(filter.typeName)
  )

  if (filters?.length) {
    filters.forEach(filter => {
      if (filter && typeof filter.typeDef === `function`) {
        typeDefinition = filter.typeDef(
          typeDefinition,
          typeBuilderApi,
          typeKind
        )
      }
    })
  }

  return typeDefinition
}

// この種の処理には graphql-js を使うべきだが、残念ながらこのプロジェクトは最初から使っていなかったので、今から使うようにリファクタリングするのは大仕事になる。将来、新しい Gatsby のソースプラグイン用ツールキットでこのプラグインを書き直す予定で、そのときに graphql-js を使う。
// イントロスペクションのフィールドの型から、これは次のような値を返す:
// `String`、`[String]`、`[String!]!`、`[String]!`、`[[String]]`、`[[String]!]!`、`[[String]!]` など
export const introspectionFieldTypeToSDL = fieldType => {
  const openingTagsList = []
  const closingTagsList = []

  let reference = fieldType

  while (reference) {
    switch (reference.kind) {
      case `SCALAR`: {
        const normalizedTypeName = supportedScalars.includes(reference.name)
          ? reference.name
          : `JSON`

        openingTagsList.push(normalizedTypeName)
        break
      }
      case `OBJECT`:
      case `INTERFACE`:
      case `UNION`:
        openingTagsList.push(buildTypeName(reference.name))
        break
      case `NON_NULL`:
        closingTagsList.push(`!`)
        break
      case `LIST`:
        openingTagsList.push(`[`)
        closingTagsList.push(`]`)
        break
      default:
        break
    }

    reference = reference.ofType
  }

  return openingTagsList.join(``) + closingTagsList.reverse().join(``)
}

/**
 * これはコストの高い関数だが、問題が起きたときにデバッグ用の警告メッセージを表示するためだけのものなので構わない。
 */
function mergeDuplicateTypesAndReturnDedupedList(typeDefs) {
  const clonedDefs = cloneDeep(typeDefs)

  const newList = []

  for (const def of clonedDefs) {
    if (!def) {
      continue
    }

    const duplicateDefs = clonedDefs.filter(
      d => d.config.name === def.config.name
    )

    const newDef = {}

    for (const dDef of duplicateDefs) {
      merge(newDef, dDef)
    }

    newList.push(newDef)
  }

  return newList
}

/**
 * 今回のビルドと、同じリモートスキーマのハッシュを持つ前回のビルドとで、組み立てた型の差分を取る。
 * 何らかのバグによって、ビルド間で一貫しないスキーマが意図せず作られた場合に、それを検出して分かりやすいエラーメッセージを追加するためである
 */
export async function diffBuiltTypeDefs(typeDefs) {
  // ユーザーが有効にした場合にだけ、スキーマの差分を取る
  if (process.env.WP_DIFF_SCHEMA_CUSTOMIZATION !== `true`) {
    return
  }

  const state = getStore().getState()

  const {
    gatsbyApi: {
      helpers: { cache, reporter },
    },
    remoteSchema,
  } = state

  const previousTypeDefsKey = withPluginKey(`previousTypeDefinitions`)

  const previousTypeDefinitions = await cache.get(previousTypeDefsKey)
  const typeDefString = JSON.stringify(typeDefs)
  const typeNames = typeDefs.map(typeDef => typeDef.config.name)

  const remoteSchemaChanged =
    !previousTypeDefinitions ||
    previousTypeDefinitions?.schemaHash !== remoteSchema.schemaHash

  if (remoteSchemaChanged) {
    await cache.set(previousTypeDefsKey, {
      schemaHash: remoteSchema.schemaHash,
      typeDefString,
      typeNames,
    })
    return
  }

  // 型定義が前回と同じなので、欠けている型や一貫しない型の確認は行わない
  if (previousTypeDefinitions?.typeDefString === typeDefString) {
    return
  }

  const missingTypeNames = previousTypeDefinitions.typeNames.filter(
    name => !typeNames.includes(name)
  )

  const previousTypeDefJson = mergeDuplicateTypesAndReturnDedupedList(
    JSON.parse(previousTypeDefinitions.typeDefString)
  )

  const newParsedTypeDefs = mergeDuplicateTypesAndReturnDedupedList(
    JSON.parse(typeDefString)
  )

  const changedTypeDefs = newParsedTypeDefs
    .map(typeDef => {
      const previousTypeDef = previousTypeDefJson.find(
        previousTypeDef => previousTypeDef.config.name === typeDef.config.name
      )

      const isDifferent = diffString(previousTypeDef, typeDef)

      if (isDifferent) {
        return `Typename ${typeDef.config.name} diff:\n${diffString(
          previousTypeDef,
          typeDef,
          {
            // 変更のない行も表示するため、もう一度差分を取る
            full: true,
          }
        )}`
      }

      return null
    })
    .filter(Boolean)

  let errorMessage = formatLogMessage(
    `The remote WPGraphQL schema hasn't changed but local generated type definitions have. This is a bug, please open an issue on Github${
      missingTypeNames.length || changedTypeDefs.length
        ? ` and include the following text.`
        : ``
    }.${
      missingTypeNames.length
        ? `\n\nMissing type names: ${missingTypeNames.join(`\n`)}\n`
        : ``
    }${
      changedTypeDefs.length
        ? `\n\nChanged type defs:\n\n${changedTypeDefs.join(`\n`)}`
        : ``
    }`
  )

  const maxErrorLength = 5000

  if (errorMessage.length > maxErrorLength) {
    errorMessage =
      errorMessage.substring(0, maxErrorLength) +
      `\n\n...\n[Diff exceeded ${maxErrorLength} characters and was truncated]`
  }

  if (process.env.WP_INCONSISTENT_SCHEMA_WARN !== `true`) {
    reporter.info(
      formatLogMessage(
        `Panicking due to inconsistent schema customization. Turn this into a warning by setting process.env.WP_INCONSISTENT_SCHEMA_WARN to a string of "true"`
      )
    )
    reporter.panic({
      id: CODES.InconsistentSchemaCustomization,
      context: {
        sourceMessage: errorMessage,
      },
    })
  } else {
    reporter.warn(errorMessage)
  }
}
