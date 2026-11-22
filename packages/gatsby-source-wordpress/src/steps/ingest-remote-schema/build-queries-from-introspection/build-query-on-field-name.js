import { getStore } from "~/store"
import { findNamedTypeName } from "~/steps/create-schema-customization/helpers"

const buildReusableFragments = ({ fragments }) =>
  Object.values(fragments)
    .map(
      ({
        name,
        type,
        fields,
        inlineFragments,
      }) => `fragment ${name} on ${type} {
      ${buildSelectionSet(fields)}
      ${buildInlineFragments(inlineFragments)}
    }`
    )
    .join(` `)

/**
 * （buildSelectionSet 関数の中で組み立てた）fragments オブジェクトを受け取り、
 * 実際のフラグメントに変換する。
 * その後、未使用のフラグメントを確認し、必要であれば未使用のフラグメントを
 * 取り除いてもう一度生成する
 */
export const generateReusableFragments = ({ fragments, selectionSet }) => {
  const fragmentsValues = Object.values(fragments)

  if (!fragmentsValues.length) {
    return ``
  }

  let builtFragments = buildReusableFragments({ fragments })

  if (fragments) {
    let regenerateFragments = false

    fragmentsValues.forEach(({ name, type }) => {
      // クエリの深さのためにクエリがフラグメントを使わず、かつそのフラグメントがほかのフラグメントでも使われていなければ、削除する
      // @todo これらのフラグメントは、使われないのであれば生成されるべきではない。
      // この todo を直せば、未使用のフラグメントを取り除くために 2 回実行する代わりに、
      // buildReusableFragments 関数を直接使える
      if (
        !selectionSet.includes(`...${name}`) &&
        !builtFragments.includes(`...${name}`)
      ) {
        delete fragments[type]
        regenerateFragments = true
      }
    })

    if (regenerateFragments) {
      builtFragments = buildReusableFragments({ fragments })
    }
  }

  return builtFragments
}

export const buildNodesQueryOnFieldName = ({
  fieldName,
  builtSelectionSet,
  builtFragments = ``,
  queryVariables = ``,
  fieldVariables = ``,
}) =>
  buildQuery({
    queryName: `NODE_LIST_QUERY`,
    variables: `$first: Int!, $after: String, ${queryVariables}`,
    fieldName,
    fieldVariables: `first: $first, after: $after, ${fieldVariables}`,
    builtSelectionSet: `
        nodes {
          ${builtSelectionSet}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      `,
    builtFragments,
  })

const buildVariables = variables =>
  variables && typeof variables === `string` ? `(${variables})` : ``

const buildInlineFragment = ({ name, fields, fragments }) => `
  ... on ${name} {
    ${buildSelectionSet(fields, { fragments })}
  }
`

const buildInlineFragments = (inlineFragments, { fragments = {} } = {}) =>
  inlineFragments
    ? `
      __typename
      ${inlineFragments
        .map(inlineFragment =>
          buildInlineFragment({ ...inlineFragment, fragments })
        )
        .join(` `)}
    `
    : ``

export const buildSelectionSet = (
  fields,
  { fragments = {}, transformedInlineFragments = [] } = {}
) => {
  if (!fields || !fields.length) {
    return ``
  }

  const {
    remoteSchema: { typeMap },
  } = getStore().getState()

  const buildFieldSelectionSet = field => {
    if (typeof field === `string`) {
      return field
    }

    let {
      fieldName,
      variables,
      fields,
      inlineFragments,
      fieldType,
      internalType,
      builtSelectionSet,
    } = field

    if (internalType === `Fragment`) {
      return `...${field.fragment.name}`
    }

    if (
      (!variables || variables === ``) &&
      fields?.find(field => field.fieldName === `nodes`)
    ) {
      // @todo nodes フィールドの有無を確認する代わりに、ここにフィールドの型を含め、
      // 入力引数を確認する。入力引数用の API のようなものがあると役立つかもしれない
      variables = `first: 100`
    }

    const selectionSet =
      builtSelectionSet ||
      buildSelectionSet(fields, {
        fragments,
      })

    const builtInlineFragments = buildInlineFragments(inlineFragments, {
      fragments,
    })

    if (fieldName && (builtInlineFragments !== `` || selectionSet !== ``)) {
      return `
        ${fieldName} ${buildVariables(variables)} {
          ${selectionSet}
          ${builtInlineFragments}
        }
      `
    } else if (fieldName) {
      const fullFieldType = typeMap.get(findNamedTypeName(fieldType))

      // このフィールドにサブフィールドがあるのに、セレクションセットを組み立てなかった場合は、
      // このフィールドを取得すべきではない。自己参照する型が、プラグインオプションの schema.circularQueryLimit で制限されているときに起こり得る。
      // @todo 上の問題は、ここではなく recursively-transform-fields.js で直すべきである。再帰は難しい :p
      if (fullFieldType.fields) {
        return null
      }

      return fieldName
    }

    return null
  }

  let inlineFragmentsSelectionSet = ``

  if (transformedInlineFragments?.length) {
    inlineFragmentsSelectionSet = transformedInlineFragments.map(
      inlineFragment => `... on ${inlineFragment.name} {
        ${inlineFragment.fields.map(buildFieldSelectionSet).filter(Boolean)
          .join(`
        `)}
      }`
    )
  }

  const selectionSet = fields.map(buildFieldSelectionSet).filter(Boolean).join(`
    `)

  return `${inlineFragmentsSelectionSet} ${selectionSet}`
}

const buildQuery = ({
  queryName,
  fieldName,
  fieldVariables,
  variables,
  builtSelectionSet,
  builtFragments = ``,
}) => `
  query ${queryName} ${buildVariables(variables)} {
    ${fieldName} ${buildVariables(fieldVariables)} {
      ${builtSelectionSet}
    }
  }

  ${builtFragments}
`

export const buildNodeQueryOnFieldName = ({
  fieldName,
  builtFragments,
  builtSelectionSet,
  variables = `$id: ID!`,
  fieldInputArguments = `id: $id`,
  queryName = `SINGLE_CONTENT_QUERY`,
}) =>
  buildQuery({
    queryName,
    variables,
    fieldName,
    fieldVariables: fieldInputArguments,
    builtFragments,
    builtSelectionSet,
  })
