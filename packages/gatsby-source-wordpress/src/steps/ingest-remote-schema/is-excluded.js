import { getStore } from "~/store"
import {
  findNamedTypeName,
  getTypeSettingsByType,
} from "~/steps/create-schema-customization/helpers"

// これらの型は Gatsby では動かない。キャッシュを確実に無効化する方法も、データを部分的に更新する方法もないためである
const blockListedTypenameParts = [
  `PluginConnection`,
  `ThemeConnection`,
  `ActionMonitorAction`,
  `EnqueuedScript`,
  `EnqueuedStylesheet`,
  `EnqueuedAsset`,
]

const seenTypesWhileBlockingByParts = {}

function typenamePartIsBlocked(name) {
  if (seenTypesWhileBlockingByParts[name]) {
    return seenTypesWhileBlockingByParts[name]
  }

  const typenameContainsBlocklistedPart = !!blockListedTypenameParts.find(b =>
    name?.includes(b)
  )

  seenTypesWhileBlockingByParts[name] = typenameContainsBlocklistedPart

  return typenameContainsBlocklistedPart
}

const typeIsExcluded = ({ pluginOptions, typeName }) =>
  typenamePartIsBlocked(typeName) ||
  (pluginOptions &&
    pluginOptions.type[typeName] &&
    pluginOptions.type[typeName].exclude)

const fieldIsExcludedOnAll = ({ pluginOptions, field }) => {
  const allFieldSettings = pluginOptions?.type?.__all

  if (!allFieldSettings) {
    return false
  }
  return !!allFieldSettings?.excludeFieldNames?.includes(field?.name)
}

const fieldIsExcludedOnParentType = ({ field, parentType }) => {
  const state = getStore().getState()
  const { typeMap } = state.remoteSchema

  const fullType = typeMap.get(findNamedTypeName(parentType))

  const parentTypeNodesField = fullType?.fields?.find(
    field => field.name === `nodes`
  )

  const parentTypeNameSettings = getTypeSettingsByType(parentType)
  const parentTypeNodesFieldTypeNameSettings = getTypeSettingsByType(
    parentTypeNodesField?.type
  )

  const fieldIsExcludedOnParentType =
    // このフィールドが親の型で除外されている場合
    parentTypeNameSettings?.excludeFieldNames?.includes(field?.name) ||
    // または、親の型が "nodes" フィールドを持ち、その型でこのフィールドが除外されている場合
    parentTypeNodesFieldTypeNameSettings?.excludeFieldNames?.includes(
      field?.name
    )

  return !!fieldIsExcludedOnParentType
}

export { typeIsExcluded, fieldIsExcludedOnAll, fieldIsExcludedOnParentType }
