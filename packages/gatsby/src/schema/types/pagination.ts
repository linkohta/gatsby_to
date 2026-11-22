import {
  SchemaComposer,
  ObjectTypeComposer,
  InputTypeComposer,
  InterfaceTypeComposer,
  ObjectTypeComposerFieldConfigMapDefinition,
  UnionTypeComposer,
  ScalarTypeComposer,
  AnyTypeComposer,
} from "graphql-compose"
import { getFieldsEnum } from "./sort"
import { addDerivedType } from "./derived-types"
import {
  createDistinctResolver,
  createGroupResolver,
  createMaxResolver,
  createMinResolver,
  createSumResolver,
} from "../resolvers"
import { convertToNestedInputType, IVisitContext } from "./utils"
import { SORTABLE_ENUM } from "./sort"

export const getPageInfo = <TContext = any>({
  schemaComposer,
}: {
  schemaComposer: SchemaComposer<TContext>
}): ObjectTypeComposer =>
  schemaComposer.getOrCreateOTC(`PageInfo`, tc => {
    tc.addFields({
      currentPage: `Int!`,
      hasPreviousPage: `Boolean!`,
      hasNextPage: `Boolean!`,
      itemCount: `Int!`,
      pageCount: `Int!`,
      perPage: `Int`,
      totalCount: `Int!`,
    })
  })

export const getEdge = <TContext = any>({
  schemaComposer,
  typeComposer,
}: {
  schemaComposer: SchemaComposer<TContext>
  typeComposer: ObjectTypeComposer | InterfaceTypeComposer
}): ObjectTypeComposer => {
  const typeName = `${typeComposer.getTypeName()}Edge`
  addDerivedType({ typeComposer, derivedTypeName: typeName })
  return schemaComposer.getOrCreateOTC(typeName, tc => {
    tc.addFields({
      next: typeComposer,
      node: typeComposer.getTypeNonNull(),
      previous: typeComposer,
    })
  })
}

export const getGroup = <TContext = any>({
  schemaComposer,
  typeComposer,
}: {
  schemaComposer: SchemaComposer<TContext>
  typeComposer: ObjectTypeComposer | InterfaceTypeComposer
}): ObjectTypeComposer => {
  const typeName = `${typeComposer.getTypeName()}GroupConnection`
  const fields = {
    field: `String!`,
    fieldValue: `String`,
  }
  return createPagination({ schemaComposer, typeComposer, typeName, fields })
}

export const getPagination = <TContext = any>({
  schemaComposer,
  typeComposer,
}: {
  schemaComposer: SchemaComposer<TContext>
  typeComposer: ObjectTypeComposer | InterfaceTypeComposer
}): ObjectTypeComposer => {
  const typeName = `${typeComposer.getTypeName()}Connection`
  return createPagination({ schemaComposer, typeComposer, typeName })
}

function getFieldSelectorTC({
  schemaComposer,
  typeComposer,
}: {
  schemaComposer: SchemaComposer<any>
  typeComposer: ObjectTypeComposer | InterfaceTypeComposer
}): AnyTypeComposer<any> {
  if (_CFLAGS_.GATSBY_MAJOR === `5`) {
    return convertToNestedInputType({
      schemaComposer,
      typeComposer,
      onEnter: ({ fieldName, typeComposer }): IVisitContext => {
        const sortable =
          typeComposer instanceof UnionTypeComposer ||
          typeComposer instanceof ScalarTypeComposer
            ? undefined
            : typeComposer.getFieldExtension(fieldName, `sortable`)
        if (sortable === SORTABLE_ENUM.NOT_SORTABLE) {
          // 走査を止める
          return null
        } else if (sortable === SORTABLE_ENUM.DEPRECATED_SORTABLE) {
          // これと、ネストしたすべてのフィールドに非推奨の印を付ける
          return {
            deprecationReason: `Sorting on fields that need arguments to resolve is deprecated.`,
          }
        }

        // 続行する
        return undefined
      },
      leafInputComposer: schemaComposer.getOrCreateETC(
        `FieldSelectorEnum`,
        etc => {
          etc.setFields({
            // GraphQL の仕様では、enum の値として "true"（や "false" や "null"）を使えないので、
            // "SELECT" を使う
            SELECT: { value: `SELECT` },
          })
        }
      ),
      postfix: `FieldSelector`,
    }).getTypeNonNull()
  } else {
    const inputTypeComposer: InputTypeComposer =
      typeComposer.getInputTypeComposer()

    const fieldsEnumTC = getFieldsEnum({
      schemaComposer,
      typeComposer,
      inputTypeComposer,
    })
    return fieldsEnumTC.getTypeNonNull()
  }
}

function createPagination<TSource = any, TContext = any>({
  schemaComposer,
  typeComposer,
  fields,
  typeName,
}: {
  schemaComposer: SchemaComposer<TContext>
  typeComposer: ObjectTypeComposer | InterfaceTypeComposer
  typeName: string
  fields?: ObjectTypeComposerFieldConfigMapDefinition<TSource, TContext>
}): ObjectTypeComposer {
  const fieldTC = getFieldSelectorTC({ schemaComposer, typeComposer })

  const paginationTypeComposer: ObjectTypeComposer =
    schemaComposer.getOrCreateOTC(typeName, tc => {
      // getGroup() は pagination への再帰呼び出しを作るので、
      // これと他の集約関数は onCreate でだけ追加する。
      // Typescript の衝突を避けるために、独自のカテゴリーにキャストする。
      const aggregationFields: { [key: string]: any } = {
        distinct: {
          type: [`String!`],
          args: {
            field: fieldTC,
          },
          resolve: createDistinctResolver(typeComposer.getTypeName()),
        },
        max: {
          type: `Float`,
          args: {
            field: fieldTC,
          },
          resolve: createMaxResolver(typeComposer.getTypeName()),
        },
        min: {
          type: `Float`,
          args: {
            field: fieldTC,
          },
          resolve: createMinResolver(typeComposer.getTypeName()),
        },
        sum: {
          type: `Float`,
          args: {
            field: fieldTC,
          },
          resolve: createSumResolver(typeComposer.getTypeName()),
        },
        group: {
          type: [getGroup({ schemaComposer, typeComposer }).getTypeNonNull()],
          args: {
            skip: `Int`,
            limit: `Int`,
            field: fieldTC,
          },
          resolve: createGroupResolver(typeComposer.getTypeName()),
        },
      }

      tc.addFields({
        totalCount: `Int!`,
        edges: [getEdge({ schemaComposer, typeComposer }).getTypeNonNull()],
        nodes: [typeComposer.getTypeNonNull()],
        pageInfo: getPageInfo({ schemaComposer }).getTypeNonNull(),
        ...aggregationFields,
        ...fields,
      })
    })
  paginationTypeComposer.makeFieldNonNull(`edges`)
  paginationTypeComposer.makeFieldNonNull(`nodes`)
  paginationTypeComposer.makeFieldNonNull(`distinct`)
  paginationTypeComposer.makeFieldNonNull(`group`)
  addDerivedType({ typeComposer, derivedTypeName: typeName })
  return paginationTypeComposer
}
