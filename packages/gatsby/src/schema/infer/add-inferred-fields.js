const _ = require(`lodash`)
const { ObjectTypeComposer } = require(`graphql-compose`)
const { GraphQLList } = require(`graphql`)
const invariant = require(`tiny-invariant`)
const report = require(`gatsby-cli/lib/reporter`)

import { isFile } from "./is-file"
import { isDate } from "../types/date"
import { addDerivedType } from "../types/derived-types"
import { reportOnce } from "../../utils/report-once"
import { is32BitInteger } from "../../utils/is-32-bit-integer"
const { getDataStore } = require(`../../datastore`)

const addInferredFields = ({
  schemaComposer,
  typeComposer,
  exampleValue,
  typeMapping,
}) => {
  const config = getInferenceConfig({
    typeComposer,
    defaults: {
      shouldAddFields: true,
    },
  })
  addInferredFieldsImpl({
    schemaComposer,
    typeComposer,
    exampleObject: exampleValue,
    prefix: typeComposer.getTypeName(),
    unsanitizedFieldPath: [typeComposer.getTypeName()],
    typeMapping,
    config,
  })

  if (deprecatedNodeKeys.size > 0) {
    const plugin = typeComposer.getExtension(`plugin`)

    reportOnce(
      `Plugin "${plugin}" is using the ___NODE convention which is deprecated. This plugin should use the @link directive instead.\nMigration: https://gatsby.dev/node-convention-deprecation`,
      `verbose`
    )
  }
}

module.exports = {
  addInferredFields,
}

const addInferredFieldsImpl = ({
  schemaComposer,
  typeComposer,
  exampleObject,
  typeMapping,
  prefix,
  unsanitizedFieldPath,
  config,
}) => {
  const fields = []
  Object.keys(exampleObject).forEach(unsanitizedKey => {
    const key = createFieldName(unsanitizedKey)
    fields.push({
      key,
      unsanitizedKey,
      exampleValue: exampleObject[unsanitizedKey],
    })
  })

  const fieldsByKey = _.groupBy(fields, field => field.key)

  Object.keys(fieldsByKey).forEach(key => {
    const possibleFields = fieldsByKey[key]
    let selectedField
    if (possibleFields.length > 1) {
      const field = resolveMultipleFields(possibleFields)
      const possibleFieldsNames = possibleFields
        .map(field => `\`${field.unsanitizedKey}\``)
        .join(`, `)
      report.warn(
        `Multiple node fields resolve to the same GraphQL field \`${prefix}.${field.key}\` - [${possibleFieldsNames}]. Gatsby will use \`${field.unsanitizedKey}\`.`
      )
      selectedField = field
    } else {
      selectedField = possibleFields[0]
    }

    const fieldConfig = getFieldConfig({
      ...selectedField,
      schemaComposer,
      typeComposer,
      prefix,
      unsanitizedFieldPath,
      typeMapping,
      config,
    })

    if (!fieldConfig) return

    if (!typeComposer.hasField(key)) {
      if (config.shouldAddFields) {
        typeComposer.addFields({ [key]: fieldConfig })
        typeComposer.setFieldExtension(key, `createdFrom`, `inference`)
      }
    }
  })

  return typeComposer
}

const deprecatedNodeKeys = new Set()

const getFieldConfig = ({
  schemaComposer,
  typeComposer,
  prefix,
  exampleValue,
  key,
  unsanitizedKey,
  unsanitizedFieldPath,
  typeMapping,
  config,
}) => {
  const selector = `${prefix}.${key}`
  unsanitizedFieldPath.push(unsanitizedKey)

  let arrays = 0
  let value = exampleValue
  while (Array.isArray(value)) {
    value = value[0]
    arrays++
  }

  let fieldConfig
  if (hasMapping(typeMapping, selector)) {
    // TODO: hasMapping と getFromMapping で、`selector` の代わりに `prefix` を使うか？
    // つまり、config にはサニタイズされたフィールド名が入っているのか？
    fieldConfig = getFieldConfigFromMapping({ typeMapping, selector })
  } else if (unsanitizedKey.includes(`___NODE`)) {
    // TODO(v5): このような外部キー（例: author___NODE___contact___email）を使える機能を削除し、
    // 代わりにスキーマのカスタマイズを使うことを推奨する

    fieldConfig = getFieldConfigFromFieldNameConvention({
      schemaComposer,
      value: exampleValue,
      key: unsanitizedKey,
    })
    arrays = arrays + (value.multiple ? 1 : 0)

    deprecatedNodeKeys.add(unsanitizedKey)
  } else {
    fieldConfig = getSimpleFieldConfig({
      schemaComposer,
      typeComposer,
      key,
      value,
      selector,
      unsanitizedFieldPath,
      typeMapping,
      config,
      arrays,
    })
  }

  unsanitizedFieldPath.pop()
  if (!fieldConfig) return null

  // 無効な文字が含まれていた場合に備えて、サニタイズ前の fieldName へリゾルバーをプロキシする
  if (key !== unsanitizedKey.split(`___NODE`)[0]) {
    fieldConfig = {
      ...fieldConfig,
      extensions: {
        ...(fieldConfig.extensions || {}),
        proxy: { from: unsanitizedKey },
      },
    }
  }

  while (arrays > 0) {
    fieldConfig = { ...fieldConfig, type: [fieldConfig.type] }
    arrays--
  }

  return fieldConfig
}

const resolveMultipleFields = possibleFields => {
  const nodeField = possibleFields.find(field =>
    field.unsanitizedKey.includes(`___NODE`)
  )
  if (nodeField) {
    return nodeField
  }

  const canonicalField = possibleFields.find(
    field => field.unsanitizedKey === field.key
  )
  if (canonicalField) {
    return canonicalField
  }

  return _.sortBy(possibleFields, field => field.unsanitizedKey)[0]
}

// XXX(freiksenet): 破壊的変更になるので、これは削除する
// これより深いネストのレベルは JSON として推論すべきである。
// const MAX_DEPTH = 5

const hasMapping = (mapping, selector) =>
  mapping && Object.keys(mapping).includes(selector)

const getFieldConfigFromMapping = ({ typeMapping, selector }) => {
  const [type, ...path] = typeMapping[selector].split(`.`)
  return {
    type,
    extensions: {
      link: { by: path.join(`.`) || `id` },
    },
  }
}

// おそらく example value の中にあるべき
const getFieldConfigFromFieldNameConvention = ({
  schemaComposer,
  value,
  key,
}) => {
  const path = key.split(`___NODE___`)[1]
  // ネストしたフィールドによるリンクを許可する。例: `author___NODE___contact___email`
  const foreignKey = path && path.replace(/___/g, `.`)
  const linkedTypesSet = new Set()

  if (foreignKey) {
    const linkedValues = new Set(value.linkedNodes)
    getDataStore()
      .iterateNodes()
      .forEach(node => {
        const value = _.get(node, foreignKey)
        if (linkedValues.has(value)) {
          linkedTypesSet.add(node.internal.type)
        }
      })
  } else {
    value.linkedNodes.forEach(id => {
      const node = getDataStore().getNode(id)
      if (node) {
        linkedTypesSet.add(node.internal.type)
      }
    })
  }

  const linkedTypes = [...linkedTypesSet]

  invariant(
    linkedTypes.length,
    `Encountered an error trying to infer a GraphQL type for: \`${key}\`. ` +
      `There is no corresponding node with the \`id\` field matching: "${value.linkedNodes}".`
  )

  let type
  // フィールドの値が、複数の型にリンクする配列である場合は、
  // GraphQLUnionType を作成する。スカラーのフィールドが異なる型に
  // リンクするケースには対応していないことに注意。同様に、外部キーのフィールドを持つ
  // オブジェクトの配列は、その外部キーのフィールドが配列であれば union 型になるが、
  // スカラーであればならない。例についてはテストを参照。
  if (linkedTypes.length > 1) {
    const typeName = linkedTypes.sort().join(``) + `Union`
    type = schemaComposer.getOrCreateUTC(typeName, utc => {
      utc.setTypes(linkedTypes.map(typeName => schemaComposer.getOTC(typeName)))
      utc.setResolveType(node => node.internal.type)
    })
  } else {
    type = linkedTypes[0]
  }

  return {
    type,
    extensions: {
      link: { by: foreignKey || `id`, from: key },
    },
  }
}

const getSimpleFieldConfig = ({
  schemaComposer,
  typeComposer,
  key,
  value,
  selector,
  unsanitizedFieldPath,
  typeMapping,
  config,
  arrays,
}) => {
  switch (typeof value) {
    case `boolean`:
      return { type: `Boolean` }
    case `number`:
      return { type: is32BitInteger(value) ? `Int` : `Float` }
    case `string`:
      if (isDate(value)) {
        return { type: `Date`, extensions: { dateformat: {} } }
      }
      if (isFile(unsanitizedFieldPath, value)) {
        // NOTE: ファイルの配列で、すべてのパスが db の File ノードを
        // 参照しているわけではない場合、フィールドが File と String の
        // どちらとして推論されるかは半ばランダムである。exampleValue は
        // 最初のエントリー（既存のファイルを指しているとは限らない）しか持たないためである。
        return { type: `File`, extensions: { fileByRelativePath: {} } }
      }
      return { type: `String` }
    case `object`:
      if (value instanceof Date) {
        return { type: `Date`, extensions: { dateformat: {} } }
      }
      if (value instanceof String) {
        return { type: `String` }
      }
      if (value /* && depth < MAX_DEPTH*/) {
        let fieldTypeComposer
        if (typeComposer.hasField(key)) {
          fieldTypeComposer = typeComposer.getFieldTC(key)
          // フィールドの値がオブジェクトであるのに、フィールドの型が
          // ObjectType 以外のものとして明示的に定義されている場合は、
          // 早めに抜けられる。
          if (!(fieldTypeComposer instanceof ObjectTypeComposer)) return null
          // フィールドの値の配列の深さと、明示的に定義された
          // フィールドの型の配列の深さが一致しない場合も、早めに抜けられる。
          let lists = 0
          let fieldType = typeComposer.getFieldType(key)
          while (fieldType.ofType) {
            if (fieldType instanceof GraphQLList) lists++
            fieldType = fieldType.ofType
          }
          if (lists !== arrays) return null
        } else {
          // フィールドの型が明示的に定義されていない場合、
          // @dontInfer であれば続ける必要はない
          if (!config.shouldAddFields) return null

          const typeName = createTypeName(selector)
          if (schemaComposer.has(typeName)) {
            // 型は、スキーマのカスタマイズによってすでに作成されているかもしれない
            fieldTypeComposer = schemaComposer.getOTC(typeName)
          } else {
            fieldTypeComposer = ObjectTypeComposer.create(
              typeName,
              schemaComposer
            )
            fieldTypeComposer.setExtension(`createdFrom`, `inference`)
            fieldTypeComposer.setExtension(
              `plugin`,
              typeComposer.getExtension(`plugin`)
            )
            addDerivedType({
              typeComposer,
              derivedTypeName: fieldTypeComposer.getTypeName(),
            })
          }
        }

        // 推論の設定オプションは、ディレクティブや拡張によって型に明示的に
        // 定義されているか、親の型から継承されているかのどちらかである。
        const inferenceConfig = getInferenceConfig({
          typeComposer: fieldTypeComposer,
          defaults: config,
        })

        return {
          type: addInferredFieldsImpl({
            schemaComposer,
            typeComposer: fieldTypeComposer,
            exampleObject: value,
            typeMapping,
            prefix: selector,
            unsanitizedFieldPath,
            config: inferenceConfig,
          }),
        }
      }
  }
  throw new Error(`Can't determine type for "${value}" in \`${selector}\`.`)
}

const createTypeName = selector => {
  const keys = selector.split(`.`)
  const suffix = keys.slice(1).map(_.upperFirst).join(``)
  return `${keys[0]}${suffix}`
}

const NON_ALPHA_NUMERIC_EXPR = new RegExp(`[^a-zA-Z0-9_]`, `g`)

/**
 * GraphQL のフィールド名は文字列でなければならず、英数字と `_` 以外を
 * 含めることはできない。また、`__` で始めることもできない。これは
 * 内部のフィールド用に予約されている（`___foo` も使えない）。
 */
const createFieldName = key => {
  // キーが本当に文字列であるかを確認する。そうでなければ GraphQL が例外を投げる。
  invariant(
    typeof key === `string`,
    `GraphQL field name (key) is not a string: \`${key}\`.`
  )

  const fieldName = key.split(`___NODE`)[0]
  const replaced = fieldName.replace(NON_ALPHA_NUMERIC_EXPR, `_`)

  // キーが無効である。先頭にアンダースコアを付け、残りを x で置き換えて正規化する
  if (replaced.match(/^__/)) {
    return replaced.replace(/_/g, (char, index) => (index === 0 ? `_` : `x`))
  }

  // キーが無効である（数字で始まっている）。先頭にアンダースコアを付けて正規化する
  if (replaced.match(/^[0-9]/)) {
    return `_` + replaced
  }

  return replaced
}

const getInferenceConfig = ({ typeComposer, defaults }) => {
  return {
    shouldAddFields: typeComposer.hasExtension(`infer`)
      ? typeComposer.getExtension(`infer`)
      : defaults.shouldAddFields,
  }
}
