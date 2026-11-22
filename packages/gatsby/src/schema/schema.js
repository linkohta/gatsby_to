const _ = require(`lodash`)
const invariant = require(`tiny-invariant`)
const {
  isSpecifiedScalarType,
  isIntrospectionType,
  assertValidName,
  GraphQLNonNull,
  GraphQLList,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLUnionType,
} = require(`graphql`)
const {
  ObjectTypeComposer,
  InterfaceTypeComposer,
  UnionTypeComposer,
  InputTypeComposer,
  ScalarTypeComposer,
  EnumTypeComposer,
} = require(`graphql-compose`)
const { getDataStore, getNode, getNodesByType } = require(`../datastore`)

const apiRunner = require(`../utils/api-runner-node`)
const report = require(`gatsby-cli/lib/reporter`)
const { addNodeInterfaceFields } = require(`./types/node-interface`)
const {
  overridableBuiltInTypeNames,
  builtInScalarTypeNames,
} = require(`./types/built-in-types`)
const { addInferredTypes } = require(`./infer`)
const {
  addRemoteFileInterfaceFields,
} = require(`./types/remote-file-interface`)

const {
  findOne,
  findManyPaginated,
  wrappingResolver,
  defaultResolver,
} = require(`./resolvers`)
const {
  processFieldExtensions,
  internalExtensionNames,
} = require(`./extensions`)
import { getPagination } from "./types/pagination"
import {
  SORTABLE_ENUM,
  getSortInput,
  getSortInputNestedObjects,
} from "./types/sort"
import { getFilterInput, SEARCHABLE_ENUM } from "./types/filter"
import { isGatsbyType, GatsbyGraphQLTypeKind } from "./types/type-builders"

const {
  isASTDocument,
  parseTypeDef,
  reportParsingError,
} = require(`./types/type-defs`)
const { printTypeDefinitions } = require(`./print`)

const buildSchema = async ({
  schemaComposer,
  types,
  typeMapping,
  fieldExtensions,
  thirdPartySchemas,
  printConfig,
  enginePrintConfig,
  typeConflictReporter,
  inferenceMetadata,
  parentSpan,
}) => {
  // FIXME: ここの .ready の削除を検討する - さまざまなテストを通すために必要である（おそらく無害だが）
  await getDataStore().ready()
  await updateSchemaComposer({
    schemaComposer,
    types,
    typeMapping,
    fieldExtensions,
    thirdPartySchemas,
    printConfig,
    enginePrintConfig,
    typeConflictReporter,
    inferenceMetadata,
    parentSpan,
  })
  // const { printSchema } = require(`graphql`)
  const schema = schemaComposer.buildSchema()
  freezeTypeComposers(schemaComposer)

  // console.log(printSchema(schema))
  return schema
}

module.exports = {
  buildSchema,
}

// https://github.com/graphql-compose/graphql-compose/issues/319 の回避策
//  FIXME: graphql-compose で修正されたら削除する
const freezeTypeComposers = (schemaComposer, excluded = new Set()) => {
  Array.from(schemaComposer.values()).forEach(tc => {
    const isCompositeTC =
      tc instanceof ObjectTypeComposer || tc instanceof InterfaceTypeComposer

    if (isCompositeTC && !excluded.has(tc.getTypeName())) {
      // typeComposer.getType() は、実際には元になる GraphQL の型を変更し、
      //   常に type._fields に thunk を代入し直す。
      //   そのため、クエリの実行時にフィールドの冗長な再定義が繰り返し起きる
      //   （パフォーマンスに大きく影響する）。
      //   変更を防ぎ、型を「凍結」する:
      const type = tc.getType()
      tc.getType = () => type
    }
  })
}

const updateSchemaComposer = async ({
  schemaComposer,
  types,
  typeMapping,
  fieldExtensions,
  thirdPartySchemas,
  printConfig,
  enginePrintConfig,
  typeConflictReporter,
  inferenceMetadata,
  parentSpan,
}) => {
  let activity = report.phantomActivity(`Add explicit types`, {
    parentSpan: parentSpan,
  })
  activity.start()
  await addTypes({ schemaComposer, parentSpan: activity.span, types })
  activity.end()

  activity = report.phantomActivity(`Add inferred types`, {
    parentSpan: parentSpan,
  })
  activity.start()
  await addInferredTypes({
    schemaComposer,
    typeConflictReporter,
    typeMapping,
    inferenceMetadata,
    parentSpan: activity.span,
  })
  addInferredChildOfExtensions({
    schemaComposer,
  })
  activity.end()

  activity = report.phantomActivity(`Processing types`, {
    parentSpan: parentSpan,
  })
  activity.start()
  if (!process.env.GATSBY_SKIP_WRITING_SCHEMA_TO_FILE) {
    await printTypeDefinitions({
      config: printConfig,
      schemaComposer,
      parentSpan: activity.span,
    })
    if (enginePrintConfig) {
      // graphql-engine をバンドルするときに使われるスキーマを確実に出力する
      await printTypeDefinitions({
        config: enginePrintConfig,
        schemaComposer,
        parentSpan: activity.span,
      })
    }
  }
  await addSetFieldsOnGraphQLNodeTypeFields({
    schemaComposer,
    parentSpan: activity.span,
  })
  await addConvenienceChildrenFields({
    schemaComposer,
    parentSpan: activity.span,
  })
  await Promise.all(
    Array.from(new Set(schemaComposer.values())).map(typeComposer =>
      processTypeComposer({
        schemaComposer,
        typeComposer,
        fieldExtensions,
        parentSpan: activity.span,
      })
    )
  )
  checkQueryableInterfaces({ schemaComposer, parentSpan: activity.span })
  await addThirdPartySchemas({
    schemaComposer,
    thirdPartySchemas,
    parentSpan: activity.span,
  })
  await addCustomResolveFunctions({ schemaComposer, parentSpan: activity.span })
  attachTracingResolver({ schemaComposer, parentSpan: activity.span })
  activity.end()
}

const processTypeComposer = async ({
  schemaComposer,
  typeComposer,
  fieldExtensions,
  parentSpan,
}) => {
  if (typeComposer instanceof ObjectTypeComposer) {
    await processFieldExtensions({
      schemaComposer,
      typeComposer,
      fieldExtensions,
      parentSpan,
    })

    if (typeComposer.hasInterface(`Node`)) {
      await addNodeInterfaceFields({ schemaComposer, typeComposer })
    }

    if (typeComposer.hasInterface(`RemoteFile`)) {
      addRemoteFileInterfaceFields(schemaComposer, typeComposer)
    }

    await determineSearchableFields({
      schemaComposer,
      typeComposer,
      parentSpan,
    })

    if (typeComposer.hasInterface(`Node`)) {
      await addTypeToRootQuery({ schemaComposer, typeComposer, parentSpan })
    }
  } else if (typeComposer instanceof InterfaceTypeComposer) {
    if (isNodeInterface(typeComposer)) {
      await addNodeInterfaceFields({ schemaComposer, typeComposer, parentSpan })

      // フィールド拡張を処理するのは、クエリできる Node インターフェースだけである。そのため、
      // ルートのクエリ型に入力引数（たとえば `dateformat` の `formatString` など）が付く
      await processFieldExtensions({
        schemaComposer,
        typeComposer,
        fieldExtensions,
        parentSpan,
      })
      await determineSearchableFields({
        schemaComposer,
        typeComposer,
        parentSpan,
      })
      await addTypeToRootQuery({ schemaComposer, typeComposer, parentSpan })
    }
  }
}

const fieldNames = {
  query: typeName => _.camelCase(typeName),
  queryAll: typeName => _.camelCase(`all ${typeName}`),
  convenienceChild: typeName => _.camelCase(`child ${typeName}`),
  convenienceChildren: typeName => _.camelCase(`children ${typeName}`),
}

const addTypes = ({ schemaComposer, types, parentSpan }) => {
  types.forEach(({ typeOrTypeDef, plugin }) => {
    if (typeof typeOrTypeDef === `string`) {
      typeOrTypeDef = parseTypeDef(typeOrTypeDef)
    }

    if (isASTDocument(typeOrTypeDef)) {
      let parsedTypes
      const createdFrom = `sdl`
      try {
        parsedTypes = parseTypes({
          doc: typeOrTypeDef,
          plugin,
          createdFrom,
          schemaComposer,
          parentSpan,
        })
      } catch (error) {
        reportParsingError(error)
        return
      }
      parsedTypes.forEach(type => {
        processAddedType({
          schemaComposer,
          type,
          parentSpan,
          createdFrom,
          plugin,
        })
      })
    } else if (isGatsbyType(typeOrTypeDef)) {
      const type = createTypeComposerFromGatsbyType({
        schemaComposer,
        type: typeOrTypeDef,
        parentSpan,
      })

      if (type) {
        const typeName = type.getTypeName()
        const createdFrom = `typeBuilder`
        checkIsAllowedTypeName(typeName)
        if (schemaComposer.has(typeName)) {
          const typeComposer = schemaComposer.get(typeName)
          mergeTypes({
            schemaComposer,
            typeComposer,
            type,
            plugin,
            createdFrom,
            parentSpan,
          })
        } else {
          processAddedType({
            schemaComposer,
            type,
            parentSpan,
            createdFrom,
            plugin,
          })
        }
      }
    } else {
      const typeName = typeOrTypeDef.name
      const createdFrom = `graphql-js`
      checkIsAllowedTypeName(typeName)
      if (schemaComposer.has(typeName)) {
        const typeComposer = schemaComposer.get(typeName)
        mergeTypes({
          schemaComposer,
          typeComposer,
          type: typeOrTypeDef,
          plugin,
          createdFrom,
          parentSpan,
        })
      } else {
        processAddedType({
          schemaComposer,
          type: typeOrTypeDef,
          parentSpan,
          createdFrom,
          plugin,
        })
      }
    }
  })
}

const mergeTypes = ({
  schemaComposer,
  typeComposer,
  type,
  plugin,
  createdFrom,
  parentSpan,
}) => {
  // 型を所有するユーザーまたはプラグインがこの型を拡張する場合、マージは安全と見なす
  // TODO: （フィールド単位での）適切な衝突の検出とレポートを追加する
  const typeOwner = typeComposer.getExtension(`plugin`)
  const isOverridableBuiltInType =
    !typeOwner && overridableBuiltInTypeNames.has(typeComposer.getTypeName())

  const isSafeMerge =
    !plugin ||
    plugin.name === `default-site-plugin` ||
    plugin.name === typeOwner ||
    typeComposer.hasExtension(`isPlaceholder`) ||
    isOverridableBuiltInType

  if (!isSafeMerge) {
    if (typeOwner) {
      report.warn(
        `Plugin \`${plugin.name}\` has customized the GraphQL type ` +
          `\`${typeComposer.getTypeName()}\`, which has already been defined ` +
          `by the plugin \`${typeOwner}\`. ` +
          `This could potentially cause conflicts.`
      )
    } else {
      report.warn(
        `Plugin \`${plugin.name}\` has customized the built-in Gatsby GraphQL type ` +
          `\`${typeComposer.getTypeName()}\`. ` +
          `This is allowed, but could potentially cause conflicts.`
      )
    }
  }

  if (
    type instanceof ObjectTypeComposer ||
    type instanceof InterfaceTypeComposer ||
    type instanceof GraphQLObjectType ||
    type instanceof GraphQLInterfaceType
  ) {
    mergeFields({ typeComposer, fields: type.getFields() })
    type.getInterfaces().forEach(iface => typeComposer.addInterface(iface))
  }

  if (
    type instanceof GraphQLInterfaceType ||
    type instanceof InterfaceTypeComposer ||
    type instanceof GraphQLUnionType ||
    type instanceof UnionTypeComposer
  ) {
    mergeResolveType({ typeComposer, type })
  }

  let extensions = {}
  if (isNamedTypeComposer(type)) {
    if (createdFrom === `sdl`) {
      extensions = convertDirectivesToExtensions(type, type.getDirectives())
    } else {
      typeComposer.extendExtensions(type.getExtensions())
    }
  }

  addExtensions({
    schemaComposer,
    typeComposer,
    extensions,
    plugin,
    createdFrom,
  })

  return true
}

const processAddedType = ({
  schemaComposer,
  type,
  parentSpan,
  createdFrom,
  plugin,
}) => {
  const typeName = schemaComposer.add(type)
  const typeComposer = schemaComposer.get(typeName)
  if (
    typeComposer instanceof InterfaceTypeComposer ||
    typeComposer instanceof UnionTypeComposer
  ) {
    if (!typeComposer.getResolveType()) {
      typeComposer.setResolveType(node => node.internal.type)
    }
  }
  schemaComposer.addSchemaMustHaveType(typeComposer)
  let extensions = {}
  if (createdFrom === `sdl`) {
    extensions = convertDirectivesToExtensions(
      typeComposer,
      typeComposer.getDirectives()
    )
  }

  addExtensions({
    schemaComposer,
    typeComposer,
    extensions,
    plugin,
    createdFrom,
  })

  return typeComposer
}

/**
 * @param {import("graphql-compose").AnyTypeComposer} typeComposer
 * @param {Array<import("graphql-compose").Directive>} directives
 * @return {{infer?: boolean, mimeTypes?: { types: Array<string> }, childOf?: { types: Array<string> }, nodeInterface?: boolean}}
 */
const convertDirectivesToExtensions = (typeComposer, directives) => {
  const extensions = {}
  directives.forEach(({ name, args }) => {
    switch (name) {
      case `infer`:
      case `dontInfer`: {
        extensions[`infer`] = name === `infer`
        break
      }
      case `mimeTypes`:
        extensions[`mimeTypes`] = args
        break
      case `childOf`:
        extensions[`childOf`] = args
        break
      case `nodeInterface`:
        if (typeComposer instanceof InterfaceTypeComposer) {
          extensions[`nodeInterface`] = true
        }
        break
      default:
    }
  })

  return extensions
}

const addExtensions = ({
  schemaComposer,
  typeComposer,
  extensions = {},
  plugin,
  createdFrom,
}) => {
  typeComposer.setExtension(`createdFrom`, createdFrom)
  typeComposer.setExtension(`plugin`, plugin ? plugin.name : null)
  typeComposer.extendExtensions(extensions)

  if (
    typeComposer instanceof InterfaceTypeComposer &&
    isNodeInterface(typeComposer)
  ) {
    const hasCorrectIdField =
      typeComposer.hasField(`id`) &&
      typeComposer.getFieldType(`id`).toString() === `ID!`

    if (!hasCorrectIdField) {
      report.panic(
        `Interfaces with the \`nodeInterface\` extension must have a field ` +
          `\`id\` of type \`ID!\`. Check the type definition of ` +
          `\`${typeComposer.getTypeName()}\`.`
      )
    }
  }

  if (
    typeComposer instanceof ObjectTypeComposer ||
    typeComposer instanceof InterfaceTypeComposer ||
    typeComposer instanceof InputTypeComposer
  ) {
    typeComposer.getFieldNames().forEach(fieldName => {
      typeComposer.setFieldExtension(fieldName, `createdFrom`, createdFrom)
      typeComposer.setFieldExtension(
        fieldName,
        `plugin`,
        plugin ? plugin.name : null
      )

      if (createdFrom === `sdl`) {
        const directives = typeComposer.getFieldDirectives(fieldName)
        directives.forEach(({ name, args }) => {
          typeComposer.setFieldExtension(fieldName, name, args)
        })
      }

      // フィールド拡張の引数を検証する。`graphql-compose` は `parseDirectives` で
      // ディレクティブの引数の型をすでに確認しているが、Type Builder で
      // 渡された拡張も確認したい。また、フィールド拡張の定義に
      // 存在しない拡張のオプションが渡された場合は、
      // 警告を出す。
      const fieldExtensions = typeComposer.getFieldExtensions(fieldName)
      const typeName = typeComposer.getTypeName()
      Object.keys(fieldExtensions)
        .filter(name => !internalExtensionNames.includes(name))
        .forEach(name => {
          const args = fieldExtensions[name]

          if (!args || typeof args !== `object`) {
            report.error(
              `Field extension arguments must be provided as an object. ` +
                `Received "${args}" on \`${typeName}.${fieldName}\`.`
            )
            return
          }

          try {
            const definition = schemaComposer.getDirective(name)

            // ディレクティブとして渡されていない場合の `defaultValue` を処理する
            definition.args.forEach(({ name, defaultValue }) => {
              if (args[name] === undefined && defaultValue !== undefined) {
                args[name] = defaultValue
              }
            })

            Object.keys(args).forEach(arg => {
              const argumentDef = definition.args.find(
                ({ name }) => name === arg
              )
              if (!argumentDef) {
                report.error(
                  `Field extension \`${name}\` on \`${typeName}.${fieldName}\` ` +
                    `has invalid argument \`${arg}\`.`
                )
                return
              }
              const value = args[arg]
              try {
                validate(argumentDef.type, value)
              } catch (error) {
                report.error(
                  `Field extension \`${name}\` on \`${typeName}.${fieldName}\` ` +
                    `has argument \`${arg}\` with invalid value "${value}". ` +
                    error.message
                )
              }
            })
          } catch (error) {
            report.error(
              `Field extension \`${name}\` on \`${typeName}.${fieldName}\` ` +
                `is not available.`
            )
          }
        })
    })
  }

  return typeComposer
}

const checkIsAllowedTypeName = name => {
  invariant(
    name !== `Node`,
    `The GraphQL type \`Node\` is reserved for internal use.`
  )
  invariant(
    !name.endsWith(`FilterInput`) && !name.endsWith(`SortInput`),
    `GraphQL type names ending with "FilterInput" or "SortInput" are ` +
      `reserved for internal use. Please rename \`${name}\`.`
  )
  invariant(
    !builtInScalarTypeNames.includes(name),
    `The GraphQL type \`${name}\` is reserved for internal use by ` +
      `built-in scalar types.`
  )
  assertValidName(name)
}

const createTypeComposerFromGatsbyType = ({
  schemaComposer,
  type,
  parentSpan,
}) => {
  let typeComposer
  switch (type.kind) {
    case GatsbyGraphQLTypeKind.OBJECT: {
      typeComposer = ObjectTypeComposer.createTemp({
        ...type.config,
        fields: () =>
          schemaComposer.typeMapper.convertOutputFieldConfigMap(
            type.config.fields
          ),
        interfaces: () => {
          if (type.config.interfaces) {
            return type.config.interfaces.map(iface => {
              if (typeof iface === `string`) {
                // 残念ながら、graphql-compose はこの関数を実行するのが早すぎる。これらの
                // インターフェースがすべてスキーマに実際に作成される前に実行されるので、
                // 一時的なプレースホルダーのコンポーザーを作らなければならない :/
                if (!schemaComposer.has(iface)) {
                  const tmpComposer = schemaComposer.createInterfaceTC(iface)
                  tmpComposer.setExtension(`isPlaceholder`, true)
                  return tmpComposer
                }
                return schemaComposer.getIFTC(iface)
              } else {
                return iface
              }
            })
          } else {
            return []
          }
        },
      })
      break
    }
    case GatsbyGraphQLTypeKind.INPUT_OBJECT: {
      typeComposer = InputTypeComposer.createTemp({
        ...type.config,
        fields: schemaComposer.typeMapper.convertInputFieldConfigMap(
          type.config.fields
        ),
      })
      break
    }
    case GatsbyGraphQLTypeKind.UNION: {
      typeComposer = UnionTypeComposer.createTemp({
        ...type.config,
        types: () => {
          if (type.config.types) {
            return type.config.types.map(typeName => {
              if (!schemaComposer.has(typeName)) {
                // 残念ながら、graphql-compose はこの関数を実行するのが早すぎる。これらの
                // 型がすべてスキーマに実際に作成される前に実行されるので、
                // 一時的なプレースホルダーのコンポーザーを作らなければならない :/
                const tmpComposer = schemaComposer.createObjectTC(typeName)
                tmpComposer.setExtension(`isPlaceholder`, true)
                return tmpComposer
              }
              return schemaComposer.getOTC(typeName)
            })
          } else {
            return []
          }
        },
      })
      break
    }
    case GatsbyGraphQLTypeKind.INTERFACE: {
      typeComposer = InterfaceTypeComposer.createTemp({
        ...type.config,
        fields: () =>
          schemaComposer.typeMapper.convertOutputFieldConfigMap(
            type.config.fields
          ),
        interfaces: () => {
          if (type.config.interfaces) {
            return type.config.interfaces.map(iface => {
              if (typeof iface === `string`) {
                // 残念ながら、graphql-compose はこの関数を実行するのが早すぎる。これらの
                // インターフェースがすべてスキーマに実際に作成される前に実行されるので、
                // 一時的なプレースホルダーのコンポーザーを作らなければならない :/
                if (!schemaComposer.has(iface)) {
                  const tmpComposer = schemaComposer.createInterfaceTC(iface)
                  tmpComposer.setExtension(`isPlaceholder`, true)
                  return tmpComposer
                }
                return schemaComposer.getIFTC(iface)
              } else {
                return iface
              }
            })
          } else {
            return []
          }
        },
      })
      break
    }
    case GatsbyGraphQLTypeKind.ENUM: {
      typeComposer = EnumTypeComposer.createTemp(type.config)
      break
    }
    case GatsbyGraphQLTypeKind.SCALAR: {
      typeComposer = ScalarTypeComposer.createTemp(type.config)
      break
    }
    default: {
      report.warn(`Illegal type definition: ${JSON.stringify(type.config)}`)
      typeComposer = null
    }
  }
  if (typeComposer) {
    // https://github.com/graphql-compose/graphql-compose/issues/311 の回避策
    typeComposer.schemaComposer = schemaComposer
  }
  return typeComposer
}

const addSetFieldsOnGraphQLNodeTypeFields = ({ schemaComposer, parentSpan }) =>
  Promise.all(
    Array.from(schemaComposer.values()).map(async tc => {
      if (tc instanceof ObjectTypeComposer && tc.hasInterface(`Node`)) {
        const typeName = tc.getTypeName()
        const result = await apiRunner(`setFieldsOnGraphQLNodeType`, {
          type: {
            name: typeName,
            get nodes() {
              // TODO STRICT_MODE: 配列の代わりにイテレーターを返す
              return getNodesByType(typeName)
            },
          },
          traceId: `initial-setFieldsOnGraphQLNodeType`,
          parentSpan,
        })
        if (result) {
          // NOTE: `setFieldsOnGraphQLNodeType` では、ネストしたフィールドは、
          // パスをプロパティ名にする形でしか設定できない。つまり
          // `{ 'frontmatter.published': 'Boolean' }` は使えるが、
          // `{ frontmatter: { published: 'Boolean' }}` の形は使えない
          result.forEach(fields => tc.addNestedFields(fields))
        }
      }
    })
  )

const addThirdPartySchemas = ({
  schemaComposer,
  thirdPartySchemas,
  parentSpan,
}) => {
  thirdPartySchemas.forEach(schema => {
    const schemaQueryType = schema.getQueryType()
    const queryTC = schemaComposer.createTempTC(schemaQueryType)
    processThirdPartyTypeFields({
      typeComposer: queryTC,
      type: schemaQueryType,
      schemaQueryType,
    })
    schemaComposer.Query.addFields(queryTC.getFields())

    // `createResolvers` API で対象にできるように、サードパーティーのスキーマの型を
    // 明示的に追加する。
    const types = schema.getTypeMap()
    Object.keys(types).forEach(typeName => {
      const type = types[typeName]
      if (
        type !== schemaQueryType &&
        !isSpecifiedScalarType(type) &&
        !isIntrospectionType(type) &&
        type.name !== `Date` &&
        type.name !== `JSON`
      ) {
        const typeHasFields =
          type instanceof GraphQLObjectType ||
          type instanceof GraphQLInterfaceType

        // Relay Classic 互換のスキーマでよくあるエッジケースへの回避策。
        // たとえば、GitHub API には次の部分がある:
        //   type Query { relay: Query }
        // gatsby-source-graphql はこれを次のように変換する:
        //   type Query { github: GitHub }
        //   type GitHub { relay: Query }
        // 問題:
        //   型 `GitHub` に対する schemaComposer.createTC(type) は、すべてのフィールドの型コンポーザーを
        //   先行して作成する（`relay` と、その型であるサードパーティーのスキーマの `Query` を含む）
        //   この想定外の `Query` コンポーザーが、こちらの Query 型のコンポーザーと干渉し、重複した型を作ってしまう。
        //   回避策は、GitHub 型のフィールドを遅延させ、この Query 型がこちらのルートの `Query` 型に
        //   すでに置き換えられた後にだけ評価されるようにすることである（processThirdPartyTypeFields を参照）:
        if (typeHasFields && typeof type._fields === `object`) {
          const fields = type._fields
          type._fields = () => fields
        }
        // ^^^ 回避策はここまで
        const typeComposer = schemaComposer.createTC(type)
        if (typeHasFields) {
          processThirdPartyTypeFields({
            typeComposer,
            type,
            schemaQueryType,
          })
        }
        typeComposer.setExtension(`createdFrom`, `thirdPartySchema`)
        schemaComposer.addSchemaMustHaveType(typeComposer)
      }
    })
  })
}

const resetOverriddenThirdPartyTypeFields = ({ typeComposer }) => {
  // 問題: createResolvers API は、サードパーティーのスキーマのインスタンスを変更する。
  //   たとえば、メインのスキーマの型を参照する新しいフィールドを追加することがある
  //   その後でスキーマを再ビルドすると、この古い型のインスタンスが新しいスキーマに
  //   紛れ込み、次の有名なエラーを引き起こす:
  //   "Schema must contain uniquely named types but contains multiple types named X"
  // この関数が影響するのは、スキーマを再ビルドする経路だけである。
  //   前回のビルドの `createResolvers` API が作った生成物を片付けて、
  //   サードパーティーのスキーマを最初の状態に戻す（そのため安全に追加し直せる）
  // TODO: これを直す正しい方法は、そもそもサードパーティーのスキーマを変更しない
  //   ことである。しかし残念ながら、変更は `graphql-compose` の中で起きており、
  //   大幅な作り直しなしにそれを避ける簡単な方法がない
  typeComposer.getFieldNames().forEach(fieldName => {
    const createdFrom = typeComposer.getFieldExtension(fieldName, `createdFrom`)
    if (createdFrom === `createResolvers`) {
      typeComposer.removeField(fieldName)
      return
    }
    const config = typeComposer.getFieldExtension(
      fieldName,
      `originalFieldConfig`
    )
    if (config) {
      typeComposer.removeField(fieldName)
      typeComposer.addFields({
        [fieldName]: config,
      })
    }
  })
}

const processThirdPartyTypeFields = ({
  typeComposer,
  type,
  schemaQueryType,
}) => {
  // Query を参照する型のための修正。Relay Classic のおかげである
  const fields = type.getFields()
  Object.keys(fields).forEach(fieldName => {
    // スキーマの再ビルドでも動くように、`createResolvers` で
    // 追加したかもしれないカスタマイズを取り除く
    const fieldType = String(fields[fieldName].type)
    if (fieldType.replace(/[[\]!]/g, ``) === schemaQueryType.name) {
      typeComposer.extendField(fieldName, {
        type: fieldType.replace(schemaQueryType.name, `Query`),
      })
    }
  })
  resetOverriddenThirdPartyTypeFields({ typeComposer })
}

const addCustomResolveFunctions = async ({ schemaComposer, parentSpan }) => {
  const intermediateSchema = schemaComposer.buildSchema()
  const createResolvers = (
    resolvers,
    { ignoreNonexistentTypes = false } = {}
  ) => {
    Object.keys(resolvers).forEach(typeName => {
      const fields = resolvers[typeName]
      if (schemaComposer.has(typeName)) {
        const tc = schemaComposer.getOTC(typeName)
        Object.keys(fields).forEach(fieldName => {
          const fieldConfig = fields[fieldName]
          if (tc.hasField(fieldName)) {
            const originalFieldConfig = tc.getFieldConfig(fieldName)
            const originalTypeName = originalFieldConfig.type.toString()
            const originalResolver = originalFieldConfig.resolve
            let fieldTypeName
            if (fieldConfig.type) {
              fieldTypeName = Array.isArray(fieldConfig.type)
                ? stringifyArray(fieldConfig.type)
                : fieldConfig.type.toString()
            }

            if (
              !fieldTypeName ||
              fieldTypeName.replace(/!/g, ``) ===
                originalTypeName.replace(/!/g, ``) ||
              tc.getExtension(`createdFrom`) === `thirdPartySchema`
            ) {
              const newConfig = {}
              if (fieldConfig.type) {
                newConfig.type = fieldConfig.type
              }
              if (fieldConfig.args) {
                newConfig.args = fieldConfig.args
              }
              if (fieldConfig.resolve) {
                newConfig.resolve = (source, args, context, info) =>
                  fieldConfig.resolve(source, args, context, {
                    ...info,
                    originalResolver:
                      originalResolver || context.defaultFieldResolver,
                  })
                tc.extendFieldExtensions(fieldName, {
                  needsResolve: true,
                })
              }
              tc.extendField(fieldName, newConfig)

              // 説明は resetOverriddenThirdPartyTypeFields を参照
              if (tc.getExtension(`createdFrom`) === `thirdPartySchema`) {
                tc.setFieldExtension(
                  fieldName,
                  `originalFieldConfig`,
                  originalFieldConfig
                )
              }
            } else if (fieldTypeName) {
              report.warn(
                `\`createResolvers\` passed resolvers for field ` +
                  `\`${typeName}.${fieldName}\` with type \`${fieldTypeName}\`. ` +
                  `Such a field with type \`${originalTypeName}\` already exists ` +
                  `on the type. Use \`createTypes\` to override type fields.`
              )
            }
          } else {
            tc.addFields({
              [fieldName]: fieldConfig,
            })
            // 説明は resetOverriddenThirdPartyTypeFields を参照
            tc.setFieldExtension(fieldName, `createdFrom`, `createResolvers`)
          }
        })
      } else if (!ignoreNonexistentTypes) {
        report.warn(
          `\`createResolvers\` passed resolvers for type \`${typeName}\` that ` +
            `doesn't exist in the schema. Use \`createTypes\` to add the type ` +
            `before adding resolvers.`
        )
      }
    })
  }
  await apiRunner(`createResolvers`, {
    intermediateSchema,
    createResolvers,
    traceId: `initial-createResolvers`,
    parentSpan,
  })
}

function attachTracingResolver({ schemaComposer }) {
  schemaComposer.forEach(typeComposer => {
    if (
      typeComposer instanceof ObjectTypeComposer ||
      typeComposer instanceof InterfaceTypeComposer
    ) {
      typeComposer.getFieldNames().forEach(fieldName => {
        const field = typeComposer.getField(fieldName)
        const resolver = wrappingResolver(field.resolve || defaultResolver)
        typeComposer.extendField(fieldName, {
          resolve: resolver,
        })
      })
    }
  })
}

const determineSearchableFields = ({ schemaComposer, typeComposer }) => {
  typeComposer.getFieldNames().forEach(fieldName => {
    const field = typeComposer.getField(fieldName)
    const extensions = typeComposer.getFieldExtensions(fieldName)
    if (field.resolve) {
      if (extensions.dateformat) {
        typeComposer.extendFieldExtensions(fieldName, {
          searchable: SEARCHABLE_ENUM.SEARCHABLE,
          sortable: SORTABLE_ENUM.SORTABLE,
          needsResolve: extensions.proxy ? true : false,
        })
      } else if (!_.isEmpty(field.args)) {
        typeComposer.extendFieldExtensions(fieldName, {
          searchable: SEARCHABLE_ENUM.DEPRECATED_SEARCHABLE,
          sortable: SORTABLE_ENUM.DEPRECATED_SORTABLE,
          needsResolve: true,
        })
      } else {
        typeComposer.extendFieldExtensions(fieldName, {
          searchable: SEARCHABLE_ENUM.SEARCHABLE,
          sortable: SORTABLE_ENUM.SORTABLE,
          needsResolve: true,
        })
      }
    } else {
      typeComposer.extendFieldExtensions(fieldName, {
        searchable: SEARCHABLE_ENUM.SEARCHABLE,
        sortable: SORTABLE_ENUM.SORTABLE,
        needsResolve: false,
      })
    }
  })
}

const addConvenienceChildrenFields = ({ schemaComposer }) => {
  const parentTypesToChildren = new Map()
  const mimeTypesToChildren = new Map()
  const typesHandlingMimeTypes = new Map()

  schemaComposer.forEach(type => {
    if (
      (type instanceof ObjectTypeComposer ||
        type instanceof InterfaceTypeComposer) &&
      type.hasExtension(`mimeTypes`)
    ) {
      const { types } = type.getExtension(`mimeTypes`)
      new Set(types).forEach(mimeType => {
        if (!typesHandlingMimeTypes.has(mimeType)) {
          typesHandlingMimeTypes.set(mimeType, new Set())
        }
        typesHandlingMimeTypes.get(mimeType).add(type)
      })
    }

    if (
      (type instanceof ObjectTypeComposer ||
        type instanceof InterfaceTypeComposer) &&
      type.hasExtension(`childOf`)
    ) {
      if (type instanceof ObjectTypeComposer && !type.hasInterface(`Node`)) {
        report.error(
          `The \`childOf\` extension can only be used on types that implement the \`Node\` interface.\n` +
            `Check the type definition of \`${type.getTypeName()}\`.`
        )
        return
      }
      if (type instanceof InterfaceTypeComposer && !isNodeInterface(type)) {
        report.error(
          `The \`childOf\` extension can only be used on types that implement the \`Node\` interface.\n` +
            `Check the type definition of \`${type.getTypeName()}\`.`
        )
        return
      }

      const { types, mimeTypes } = type.getExtension(`childOf`)

      new Set(types).forEach(parentType => {
        if (!parentTypesToChildren.has(parentType)) {
          parentTypesToChildren.set(parentType, new Set())
        }
        parentTypesToChildren.get(parentType).add(type)
      })
      new Set(mimeTypes).forEach(mimeType => {
        if (!mimeTypesToChildren.has(mimeType)) {
          mimeTypesToChildren.set(mimeType, new Set())
        }
        mimeTypesToChildren.get(mimeType).add(type)
      })
    }
  })

  parentTypesToChildren.forEach((children, parent) => {
    if (!schemaComposer.has(parent)) return
    const typeComposer = schemaComposer.getAnyTC(parent)
    if (
      typeComposer instanceof InterfaceTypeComposer &&
      !isNodeInterface(typeComposer)
    ) {
      report.error(
        `With the \`childOf\` extension, children fields can only be added to ` +
          `interfaces which implement the \`Node\` interface.\n` +
          `Check the type definition of \`${typeComposer.getTypeName()}\`.`
      )
      return
    }
    children.forEach(child => {
      typeComposer.addFields(createChildrenField(child.getTypeName()))
      typeComposer.addFields(createChildField(child.getTypeName()))
    })
  })

  mimeTypesToChildren.forEach((children, mimeType) => {
    const parentTypes = typesHandlingMimeTypes.get(mimeType)
    if (parentTypes) {
      parentTypes.forEach(typeComposer => {
        if (
          typeComposer instanceof InterfaceTypeComposer &&
          !isNodeInterface(typeComposer)
        ) {
          report.error(
            `With the \`childOf\` extension, children fields can only be added to ` +
              `interfaces which implement the \`Node\` interface.\n` +
              `Check the type definition of \`${typeComposer.getTypeName()}\`.`
          )
          return
        }
        children.forEach(child => {
          typeComposer.addFields(createChildrenField(child.getTypeName()))
          typeComposer.addFields(createChildField(child.getTypeName()))
        })
      })
    }
  })
}

const isExplicitChild = ({ typeComposer, childTypeComposer }) => {
  if (!childTypeComposer.hasExtension(`childOf`)) {
    return false
  }
  const childOfExtension = childTypeComposer.getExtension(`childOf`)
  const { types: parentMimeTypes = [] } =
    typeComposer.getExtension(`mimeTypes`) ?? {}

  return (
    childOfExtension?.types?.includes(typeComposer.getTypeName()) ||
    childOfExtension?.mimeTypes?.some(mimeType =>
      parentMimeTypes.includes(mimeType)
    )
  )
}

const addInferredChildOfExtensions = ({ schemaComposer }) => {
  schemaComposer.forEach(typeComposer => {
    if (
      typeComposer instanceof ObjectTypeComposer &&
      typeComposer.hasInterface(`Node`)
    ) {
      addInferredChildOfExtension({
        schemaComposer,
        typeComposer,
      })
    }
  })
}

const addInferredChildOfExtension = ({ schemaComposer, typeComposer }) => {
  const shouldInfer = typeComposer.getExtension(`infer`)
  // `@dontInfer` の場合は、`@childOf` 拡張で明示的に設定された
  // 親子関係だけが追加される。
  if (shouldInfer === false) return

  const parentTypeName = typeComposer.getTypeName()

  // これはコストが高い。
  // TODO: おそらく、この情報は推論のメタデータを作る段階で集めるべきである
  const childNodeTypes = new Set()
  for (const node of getDataStore().iterateNodesByType(parentTypeName)) {
    const children = (node.children || []).map(getNode)
    for (const childNode of children) {
      if (childNode?.internal?.type) {
        childNodeTypes.add(childNode.internal.type)
      }
    }
  }

  childNodeTypes.forEach(typeName => {
    const childTypeComposer = schemaComposer.getAnyTC(typeName)
    let childOfExtension = childTypeComposer.getExtension(`childOf`)

    if (isExplicitChild({ typeComposer, childTypeComposer })) {
      return
    }
    // `@childOf` 拡張を自動的に設定する
    // これにより、`childImageSharp` のような便利な children のフィールドが
    // `addConvenienceChildrenFields` メソッドで追加される。
    // スナップショットプラグインで `@childOf` ディレクティブを正しく出力するためにも必要である
    if (!childOfExtension) {
      childOfExtension = {}
    }
    if (!childOfExtension.types) {
      childOfExtension.types = []
    }
    childOfExtension.types.push(parentTypeName)
    childTypeComposer.setExtension(`childOf`, childOfExtension)
  })
}

const createChildrenField = typeName => {
  return {
    [fieldNames.convenienceChildren(typeName)]: {
      type: () => [typeName],
      description: `Returns all children nodes filtered by type ${typeName}`,
      resolve(source, args, context) {
        const { path } = context
        return context.nodeModel.getNodesByIds(
          { ids: source.children, type: typeName },
          { path }
        )
      },
    },
  }
}

const createChildField = typeName => {
  return {
    [fieldNames.convenienceChild(typeName)]: {
      type: () => typeName,
      description:
        `Returns the first child node of type ${typeName} ` +
        `or null if there are no children of given type on this node`,
      resolve(source, args, context) {
        const { path } = context
        const result = context.nodeModel.getNodesByIds(
          { ids: source.children, type: typeName },
          { path }
        )
        if (result && result.length > 0) {
          return result[0]
        } else {
          return null
        }
      },
    },
  }
}

const addTypeToRootQuery = ({ schemaComposer, typeComposer }) => {
  const filterInputTC = getFilterInput({
    schemaComposer,
    typeComposer,
  })
  const paginationTC = getPagination({
    schemaComposer,
    typeComposer,
  })

  const typeName = typeComposer.getTypeName()
  // 厳密には正しくないが、型 `NPMPackage` からの結果は `npmPackage` と `allNpmPackage` になる
  const queryName = fieldNames.query(typeName)
  const queryNamePlural = fieldNames.queryAll(typeName)

  schemaComposer.Query.addFields({
    [queryName]: {
      type: typeComposer,
      args: {
        ...filterInputTC.getFields(),
      },
      resolve: findOne(typeName),
    },
    [queryNamePlural]: {
      type: paginationTC,
      args: {
        filter: filterInputTC,
        sort:
          _CFLAGS_.GATSBY_MAJOR === `5`
            ? getSortInputNestedObjects({ schemaComposer, typeComposer })
            : getSortInput({
                schemaComposer,
                typeComposer,
              }),

        skip: `Int`,
        limit: `Int`,
      },
      resolve: findManyPaginated(typeName),
    },
  }).makeFieldNonNull(queryNamePlural)
}

const parseTypes = ({
  doc,
  plugin,
  createdFrom,
  schemaComposer,
  parentSpan,
}) => {
  const types = []
  doc.definitions.forEach(def => {
    const name = def.name.value
    checkIsAllowedTypeName(name)

    if (schemaComposer.has(name)) {
      // ast.kind がコンポーザーの型と一致するかは確認しない。何かが
      // おかしければ例外が投げられ、`reportParsingError` によって
      // 報告されることに頼っている。

      // 元の型コンポーザーを取っておく
      const typeComposer = schemaComposer.get(name)

      // この後、パースした型コンポーザーが、その型名を扱うコンポーザーとして
      // 登録される（マージ後に片付けが必要。下を参照）
      const parsedType = schemaComposer.typeMapper.makeSchemaDef(def)

      // 型をマージするには、実装しているインターフェースがすでに存在している必要がある。
      // 型を作成する順序によっては、インターフェースがまだ処理されていない
      // ことがある。インターフェースがすでに存在するかを確認し、
      // まだ存在しなければプレースホルダーを作成する。
      if (parsedType.getInterfaces) {
        parsedType.getInterfaces().forEach(iface => {
          const ifaceName = iface.getTypeName()
          if (!schemaComposer.has(ifaceName)) {
            const tmpComposer = schemaComposer.createInterfaceTC(ifaceName)
            tmpComposer.setExtension(`isPlaceholder`, true)
          }
        })
      }

      // パースした型を元の型とマージする
      mergeTypes({
        schemaComposer,
        typeComposer,
        type: parsedType,
        plugin,
        createdFrom,
        parentSpan,
      })

      // 片付け:
      // 元の型コンポーザー（マージしたフィールドが追加されたもの）を
      // その型名の正しいコンポーザーとして設定し、一時的なものを取り除く
      // `graphql-compose` ではこれが簡単にはできない 🤯
      // TODO: 次の Issue が修正されたら、ここを整理する:
      //  https://github.com/graphql-compose/graphql-compose/issues/311
      schemaComposer.set(typeComposer.getTypeName(), typeComposer)
      schemaComposer.set(typeComposer._gqType, typeComposer)
      schemaComposer.delete(parsedType._gqType)
      schemaComposer.delete(parsedType)
    } else {
      const parsedType = schemaComposer.typeMapper.makeSchemaDef(def)
      types.push(parsedType)
    }
  })
  return types
}

const stringifyArray = arr =>
  `[${arr.map(item =>
    Array.isArray(item) ? stringifyArray(item) : item.toString()
  )}]`

// TODO: v7 に更新したら、これを graphql-compose から直接 import する
const isNamedTypeComposer = type =>
  type instanceof ObjectTypeComposer ||
  type instanceof InputTypeComposer ||
  type instanceof ScalarTypeComposer ||
  type instanceof EnumTypeComposer ||
  type instanceof InterfaceTypeComposer ||
  type instanceof UnionTypeComposer

const validate = (type, value) => {
  if (type instanceof GraphQLNonNull) {
    if (value == null) {
      throw new Error(`Expected non-null field value.`)
    }
    return validate(type.ofType, value)
  } else if (type instanceof GraphQLList) {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array field value.`)
    }
    return value.map(v => validate(type.ofType, v))
  } else {
    return type.parseValue(value)
  }
}

const isNodeInterface = interfaceTypeComposer =>
  interfaceTypeComposer.hasInterface(`Node`)

const checkQueryableInterfaces = ({ schemaComposer }) => {
  const queryableInterfaces = new Set()
  schemaComposer.forEach(type => {
    if (type instanceof InterfaceTypeComposer && isNodeInterface(type)) {
      queryableInterfaces.add(type.getTypeName())
    }
  })
  const incorrectTypes = new Set()
  schemaComposer.forEach(type => {
    if (type instanceof ObjectTypeComposer) {
      const interfaces = type.getInterfaces()
      if (
        interfaces.some(iface =>
          queryableInterfaces.has(iface.getTypeName())
        ) &&
        !type.hasInterface(`Node`)
      ) {
        incorrectTypes.add(type.getTypeName())
      }
    }
  })
  if (incorrectTypes.size) {
    report.panic(
      `Types implementing queryable interfaces must also implement the \`Node\` ` +
        `interface. Check the type definition of ` +
        `${Array.from(incorrectTypes)
          .map(t => `\`${t}\``)
          .join(`, `)}.`
    )
  }
}

const mergeFields = ({ typeComposer, fields }) =>
  Object.entries(fields).forEach(([fieldName, fieldConfig]) => {
    if (typeComposer.hasField(fieldName)) {
      typeComposer.extendField(fieldName, fieldConfig)
    } else {
      typeComposer.setField(fieldName, fieldConfig)
    }
  })

const mergeResolveType = ({ typeComposer, type }) => {
  if (
    (type instanceof GraphQLInterfaceType ||
      type instanceof GraphQLUnionType) &&
    type.resolveType
  ) {
    typeComposer.setResolveType(type.resolveType)
  }
  if (
    (type instanceof InterfaceTypeComposer ||
      type instanceof UnionTypeComposer) &&
    type.getResolveType()
  ) {
    typeComposer.setResolveType(type.getResolveType())
  }
  if (!typeComposer.getResolveType()) {
    typeComposer.setResolveType(node => node?.internal?.type)
  }
}
