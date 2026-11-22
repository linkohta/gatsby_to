/**
 * 派生型とは、基になる型が存在するときにだけ意味を持つ型である
 *
 * 次のノードを例にする:
 * {
 *   internal: { type: 'Foo' },
 *   fields: {
 *     bar: "string",
 *   }
 * }
 *
 * これは次の型を生成する:
 * Foo
 * FooFields
 *
 * FooInputFilter
 * FooSortInput
 *
 * FooFieldsInputFilter
 * FooFieldsSortFilter
 * など
 *
 * 派生型:
 *   Foo: FooFields, FooInputFilter, FooSortInput
 *   FooFields: FooFieldsInputFilter, FooFieldsSortFilter
 *
 * 注意点:
 *   派生型として印が付くのは、推論によって作成された型だけである。そのため、上の例で
 *   ユーザーが（`createTypes` の呼び出しで）`FooFields` 型を明示的に定義した場合、
 *   それは派生型とは見なされない
 */
import {
  ObjectTypeComposer,
  InterfaceTypeComposer,
  ScalarTypeComposer,
  SchemaComposer,
  InputTypeComposer,
  EnumTypeComposer,
  UnionTypeComposer,
} from "graphql-compose"

type AllTypeComposer =
  | ObjectTypeComposer
  | InputTypeComposer
  | EnumTypeComposer
  | InterfaceTypeComposer
  | UnionTypeComposer
  | ScalarTypeComposer

const getDerivedTypes = ({
  typeComposer,
}: {
  typeComposer: AllTypeComposer
}): Set<string> => {
  const derivedTypes = typeComposer.getExtension(`derivedTypes`)
  if (derivedTypes) {
    return derivedTypes as Set<string>
  }

  return new Set()
}

export const deleteFieldsOfDerivedTypes = ({ typeComposer }): void => {
  const derivedTypes = getDerivedTypes({ typeComposer })

  typeComposer.getFieldNames().forEach(fieldName => {
    const fieldType = typeComposer.getField(fieldName).type

    if (derivedTypes.has(fieldType.getTypeName())) {
      typeComposer.removeField(fieldName)
    }
  })
}

const removeTypeFromSchemaComposer = ({
  schemaComposer,
  typeComposer,
}): void => {
  schemaComposer.delete(typeComposer.getTypeName())
  schemaComposer.delete((typeComposer as any)._gqType)
  schemaComposer.delete(typeComposer)
}

export const clearDerivedTypes = ({
  schemaComposer,
  typeComposer,
}: {
  schemaComposer: SchemaComposer<any>
  typeComposer: AllTypeComposer
}): void => {
  const derivedTypes = getDerivedTypes({ typeComposer })

  for (const typeName of derivedTypes.values()) {
    const derivedTypeComposer = schemaComposer.getAnyTC(typeName)
    clearDerivedTypes({ schemaComposer, typeComposer: derivedTypeComposer })
    removeTypeFromSchemaComposer({
      schemaComposer,
      typeComposer: derivedTypeComposer,
    })
  }

  if (
    typeComposer instanceof ObjectTypeComposer ||
    typeComposer instanceof InterfaceTypeComposer
  ) {
    const inputTypeComposer = typeComposer.getInputTypeComposer()
    removeTypeFromSchemaComposer({
      schemaComposer,
      typeComposer: inputTypeComposer,
    })
    typeComposer.removeInputTypeComposer()
  }

  typeComposer.setExtension(`derivedTypes`, new Set())
}

export const addDerivedType = ({
  typeComposer,
  derivedTypeName,
}: {
  typeComposer: AllTypeComposer
  derivedTypeName: string
}): void => {
  const derivedTypes = getDerivedTypes({ typeComposer })
  typeComposer.setExtension(`derivedTypes`, derivedTypes.add(derivedTypeName))
}
