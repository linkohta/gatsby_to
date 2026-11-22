import { getStore } from "~/store"
import { typeIsExcluded } from "~/steps/ingest-remote-schema/is-excluded"
import { typeIsABuiltInScalar } from "../create-schema-customization/helpers"
import {
  findNamedTypeName,
  getTypesThatImplementInterfaceType,
  findNamedType,
} from "~/steps/create-schema-customization/helpers"
import { transformFields } from "../create-schema-customization/transform-fields"
import { getPersistentCache } from "~/utils/cache"

const identifyAndStoreIngestableFieldsAndTypes = async () => {
  const nodeListFilter = field => field.name === `nodes`

  const state = getStore().getState()
  const { introspectionData, fieldBlacklist, typeMap } = state.remoteSchema
  const { pluginOptions } = state.gatsbyApi

  const cachedFetchedTypes = await getPersistentCache({
    key: `previously-fetched-types`,
  })

  if (cachedFetchedTypes) {
    const restoredFetchedTypesMap = new Map(cachedFetchedTypes)

    getStore().dispatch.remoteSchema.setState({
      fetchedTypes: restoredFetchedTypesMap,
    })
  }

  const nodeInterfaceTypes = []
  const nodeListRootFields = []
  const nonNodeRootFields = []
  const nodeInterfacePossibleTypeNames = []

  if (pluginOptions.type) {
    Object.entries(pluginOptions.type).forEach(([typeName, typeSettings]) => {
      // 遅延型は最初は取得されないので、
      // ここで取得済みとして印を付ける必要がある
      if (
        (typeSettings.lazyNodes || pluginOptions.type?.__all?.lazyNodes) &&
        !typeIsExcluded({ pluginOptions, typeName })
      ) {
        const lazyType = typeMap.get(typeName)
        getStore().dispatch.remoteSchema.addFetchedType(lazyType)
      }

      if (typeSettings.nodeInterface) {
        nodeInterfaceTypes.push(typeName)
      }
    })
  }

  const rootFields = typeMap.get(`RootQuery`).fields

  for (const field of rootFields) {
    const fieldHasNonNullArgs = field.args.some(
      arg => arg.type.kind === `NON_NULL`
    )

    if (fieldHasNonNullArgs) {
      // これらの引数に何を渡すべきか分からないので、このフィールドはスキップする
      continue
    }

    if (
      typeIsExcluded({
        pluginOptions,
        typeName: findNamedType(field.type).name,
      })
    ) {
      continue
    }

    if (field.type.kind === `OBJECT`) {
      const type = typeMap.get(field.type.name)

      const nodeField = type?.fields?.find(nodeListFilter)

      if (nodeField && findNamedType(nodeField.type).kind === `INTERFACE`) {
        const nodeListField = type.fields.find(nodeListFilter)

        if (nodeListField) {
          if (
            typeIsExcluded({
              typeName: findNamedTypeName(nodeListField.type),
              pluginOptions,
            })
          ) {
            continue
          }

          nodeInterfaceTypes.push(findNamedTypeName(nodeListField.type))

          getStore().dispatch.remoteSchema.addFetchedType(nodeListField.type)

          const nodeListFieldType = typeMap.get(
            findNamedTypeName(nodeListField.type)
          )

          for (const innerField of nodeListFieldType.fields) {
            if (
              !typeIsExcluded({
                typeName: findNamedTypeName(innerField.type),
                pluginOptions,
              })
            ) {
              getStore().dispatch.remoteSchema.addFetchedType(innerField.type)
            }
          }

          if (
            // これを nodeInterface 型としてマークしていなければ、取得するためにルートフィールドへ追加する
            // nodeInterface は、インターフェース型であるノードとは別のものである。
            // Gatsby での nodeInterface は、ノードのデータを別の型から取得することを意味する。WP 側にもインターフェース型のノードはあり得るが、それらは 1 つのルートフィールドからしか取得しない
            // 問題は、それらをノードリストのルートフィールドとしてマークしておかないと、
            // 後で取得済みのノードタイプとして識別できず、ノードのソーシング中にこの型を取得しようともしなくなることである。
            !pluginOptions?.type?.[findNamedTypeName(nodeListField.type)]
              ?.nodeInterface
          ) {
            const nodeInterfaceType = typeMap.get(
              findNamedTypeName(nodeListField.type)
            )

            // 取り得るすべての型を取得済みとしてマークし、
            // さらにその型をノードタイプとして記録する必要がある
            for (const type of nodeInterfaceType?.possibleTypes || []) {
              if (
                !typeIsExcluded({
                  typeName: findNamedTypeName(type),
                  pluginOptions,
                })
              ) {
                nodeInterfacePossibleTypeNames.push(type.name)
                getStore().dispatch.remoteSchema.addFetchedType(type)
              }
            }

            nodeListRootFields.push(field)
          }

          continue
        }
      } else if (nodeField) {
        if (
          fieldBlacklist.includes(field.name) ||
          typeIsExcluded({
            typeName: findNamedType(field.type).name,
            pluginOptions,
          })
        ) {
          continue
        }

        getStore().dispatch.remoteSchema.addFetchedType(nodeField.type)

        nodeListRootFields.push(field)
        continue
      }
    }

    if (fieldBlacklist.includes(field.name)) {
      continue
    }

    const takesIDinput = field?.args?.find(arg => arg.type.name === `ID`)

    // ノードではないルートフィールドが id を入力に取る場合、99% の確率で使えない。
    // そのため、取得もせず、スキーマにも追加しない。
    if (takesIDinput) {
      continue
    }

    if (
      // この型が RootQuery で除外されていれば、スキップする
      pluginOptions.type.RootQuery?.excludeFieldNames?.find(
        excludedFieldName => excludedFieldName === field.name
      )
    ) {
      continue
    }

    // 対応済みの SCALAR 型であれば、取得済みとしてマークする必要はない
    if (!typeIsABuiltInScalar(field.type)) {
      getStore().dispatch.remoteSchema.addFetchedType(field.type)
    }

    nonNodeRootFields.push(field)
  }

  const interfaces = introspectionData.__schema.types.filter(
    type => type.kind === `INTERFACE`
  )

  for (const interfaceType of interfaces) {
    if (typeIsExcluded({ pluginOptions, typeName: interfaceType.name })) {
      continue
    }

    if (!interfaceType.fields) {
      continue
    }

    const typesThatImplementInterface =
      getTypesThatImplementInterfaceType(interfaceType)

    const shouldSkipInterfaceType = !transformFields({
      fields: interfaceType.fields,
      parentType: interfaceType,
      parentInterfacesImplementingTypes: typesThatImplementInterface,
      peek: true,
    })

    if (shouldSkipInterfaceType && interfaceType.name !== `Node`) {
      continue
    }

    getStore().dispatch.remoteSchema.addFetchedType(interfaceType)

    if (interfaceType.fields) {
      for (const interfaceField of interfaceType.fields) {
        if (
          interfaceField.type &&
          !typeIsExcluded({
            typeName: findNamedType(interfaceField.type).name,
            pluginOptions,
          })
        ) {
          getStore().dispatch.remoteSchema.addFetchedType(interfaceField.type)
        }
      }
    }
  }

  const nodeListFieldNames = nodeListRootFields.map(field => field.name)

  const nodeListTypeNames = [
    ...nodeInterfacePossibleTypeNames,
    ...nodeListRootFields.map(field => {
      const connectionType = typeMap.get(field.type.name)

      const nodesField = connectionType.fields.find(nodeListFilter)
      return findNamedType(nodesField.type).name
    }),
  ]

  const gatsbyNodesInfo = {
    fieldNames: nodeListFieldNames,
    typeNames: nodeListTypeNames,
  }

  getStore().dispatch.remoteSchema.setState({
    gatsbyNodesInfo,
    ingestibles: {
      nodeListRootFields,
      nonNodeRootFields,
      nodeInterfaceTypes,
    },
  })
}

export { identifyAndStoreIngestableFieldsAndTypes }
