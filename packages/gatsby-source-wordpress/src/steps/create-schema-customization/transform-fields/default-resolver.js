import { findNamedTypeName } from "~/steps/create-schema-customization/helpers"

import { buildGatsbyNodeObjectResolver } from "~/steps/create-schema-customization/transform-fields/transform-object"
import { buildTypeName } from "../helpers"

export const buildDefaultResolver = transformerApi => (source, _, context) => {
  const { fieldName, field, gatsbyNodeTypes, pluginOptions } = transformerApi
  const prefix = pluginOptions.schema.typePrefix

  let finalFieldValue

  const resolvedField = source[fieldName]

  if (typeof resolvedField !== `undefined`) {
    finalFieldValue = resolvedField
  }

  const autoAliasedFieldPropertyName = `${fieldName}__typename_${field?.type?.name}`

  const aliasedField = source[autoAliasedFieldPropertyName]

  if (
    typeof resolvedField === `undefined` &&
    typeof aliasedField !== `undefined`
  ) {
    finalFieldValue = aliasedField
  }

  // findNamedTypeName ヘルパーは、このリゾルバーがしばらく本番で
  // 使われた後に書かれた。
  // そのため、このリゾルバーにとって正しい型名を、すべての場合に
  // 見つけられるかどうかは分からない。
  // そこで、従来の方法を上の autoAliasedFieldPropertyName に残している
  // @todo さまざまな WPGraphQL の拡張を使った、網羅的なデータ解決の
  // 統合テストを書く
  // その後ここに戻って `return aliasedField` の行を削除し、
  // それでもすべてが正しく解決されるかを確認する
  const typeName = findNamedTypeName(field.type)
  const autoAliasedFieldName = `${fieldName}__typename_${typeName}`

  const aliasedField2 = source[autoAliasedFieldName]

  if (
    typeof resolvedField === `undefined` &&
    typeof aliasedField2 !== `undefined`
  ) {
    finalFieldValue = aliasedField2
  }

  if (finalFieldValue?.__typename) {
    // Gatsby V3 では、インターフェースフィールドの型の判定に、resolveType 関数ではなくこのプロパティが使われる。
    // そのため、型が見つからないというエラーを gql が投げないよう、接頭辞を付ける必要がある。
    finalFieldValue.__typename = buildTypeName(
      finalFieldValue.__typename,
      prefix
    )
  }

  const isANodeConnection =
    // このフィールドが id と typename しか持たない場合
    finalFieldValue?.id &&
    finalFieldValue?.__typename &&
    Object.keys(finalFieldValue).length === 2 &&
    // かつ、Gatsby のノードタイプである場合
    gatsbyNodeTypes.includes(finalFieldValue.__typename)

  if (isANodeConnection) {
    const gatsbyNodeResolver = buildGatsbyNodeObjectResolver(transformerApi)
    return gatsbyNodeResolver(source, _, context)
  }

  return finalFieldValue
}
