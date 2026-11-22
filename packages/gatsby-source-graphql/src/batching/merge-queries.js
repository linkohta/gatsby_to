const { visit, visitInParallel, Kind } = require(`gatsby/graphql`)
const _ = require(`lodash`)

const Prefix = {
  create: index => `gatsby${index}_`,
  parseKey: prefixedKey => {
    const match = /^gatsby([\d]+)_(.*)$/.exec(prefixedKey)
    if (!match || match.length !== 3 || isNaN(Number(match[1])) || !match[2]) {
      throw new Error(`Unexpected data key: ${prefixedKey}`)
    }
    return { index: Number(match[1]), originalKey: match[2] }
  },
}

/**
 * 複数のクエリを 1 つのクエリにマージする。クエリの結果を、元のクエリを実行して
 * 得たかのように分割して変換できる形にする。
 *
 * マージのアルゴリズムは、いくつかの変換からなる:
 *  1. トップレベルのフラグメントスプレッドをインラインフラグメントに置き換える (... on Query {})
 *  2. トップレベルのすべてのクエリフィールド（インラインフラグメント上のものを含む）に一意なエイリアスを付ける
 *  3. すべての変数定義と変数の使用箇所に接頭辞を付ける
 *  4. 変数を持つフラグメントの名前（とスプレッド）に接頭辞を付ける
 *  5. 繰り返し現れるフラグメントの重複を取り除く
 *
 * つまり、次のものを:
 *   [
 *     `query Foo($id: ID!) { foo, bar(id: $id), ...FooQuery }
 *     fragment FooQuery on Query { baz }`,
 *
 *    `query Bar($id: ID!) { foo: baz, bar(id: $id), ... on Query { baz } }`
 *   ]
 * 次のように変換する:
 *   query (
 *     $gatsby1_id: ID!
 *     $gatsby2_id: ID!
 *   ) {
 *     gatsby1_foo: foo,
 *     gatsby1_bar: bar(id: $gatsby1_id)
 *     ... on Query @originalFragment(name: "FooQuery") {
 *       gatsby1_baz: baz
 *     }
 *     gatsby2_foo: baz
 *     gatsby2_bar: bar(id: $gatsby2_id)
 *     ... on Query {
 *       gatsby2_baz: baz
 *     }
 *   }
 *   fragment FooQuery on Query { baz }
 */
export function merge(queries) {
  const mergedVariables = {}
  const mergedVariableDefinitions = []
  const mergedSelections = []
  const mergedFragmentMap = new Map()

  queries.forEach((query, index) => {
    const prefixedQuery = prefixQueryParts(Prefix.create(index), query)

    prefixedQuery.query.definitions.forEach(def => {
      if (isQueryDefinition(def)) {
        mergedSelections.push(...def.selectionSet.selections)
        mergedVariableDefinitions.push(...(def.variableDefinitions ?? []))
      }
      if (isFragmentDefinition(def)) {
        // 理論上は、名前が同じで内容が異なるフラグメントが、別々のクエリに存在することもあり得る。
        // しかし Gatsby の検証はこれを許可しておらず、ここではそれを前提にしている
        // これが起こり得る例の 1 つは、gatsby-node や GraphiQL のクエリである
        // （ただし、それらは通常バッチ処理されない）
        mergedFragmentMap.set(def.name.value, def)
      }
    })
    Object.assign(mergedVariables, prefixedQuery.variables)
  })

  const mergedQueryDefinition = {
    kind: Kind.OPERATION_DEFINITION,
    operation: `query`,
    variableDefinitions: mergedVariableDefinitions,
    selectionSet: {
      kind: Kind.SELECTION_SET,
      selections: mergedSelections,
    },
  }

  return {
    query: {
      kind: Kind.DOCUMENT,
      definitions: [mergedQueryDefinition, ...mergedFragmentMap.values()],
    },
    variables: mergedVariables,
  }
}

/**
 * `merge` 関数が作成したクエリの結果を分割して変換する
 */
export function resolveResult(mergedQueryResult) {
  const data = mergedQueryResult.data

  return Object.keys(data).reduce((acc, prefixedKey) => {
    const { index, originalKey } = Prefix.parseKey(prefixedKey)
    if (!acc[index]) acc[index] = { data: {} }
    acc[index].data[originalKey] = data[prefixedKey]
    return acc
  }, [])
}

const Visitors = {
  detectFragmentsWithVariables: fragmentsWithVariables => {
    let currentFragmentName
    return {
      [Kind.FRAGMENT_DEFINITION]: {
        enter: def => {
          currentFragmentName = def.name.value
        },
        leave: () => {
          currentFragmentName = null
        },
      },
      [Kind.VARIABLE]: () => {
        if (currentFragmentName) {
          fragmentsWithVariables.add(currentFragmentName)
        }
      },
    }
  },
  prefixVariables: prefix => {
    return {
      [Kind.VARIABLE]: variable => prefixNodeName(variable, prefix),
    }
  },
  prefixFragmentNames: (prefix, fragmentNames) => {
    return {
      [Kind.FRAGMENT_DEFINITION]: def =>
        fragmentNames.has(def.name.value) ? prefixNodeName(def, prefix) : def,
      [Kind.FRAGMENT_SPREAD]: def =>
        fragmentNames.has(def.name.value) ? prefixNodeName(def, prefix) : def,
    }
  },
}

function prefixQueryParts(prefix, query) {
  let document = aliasTopLevelFields(prefix, query.query)
  const variableNames = Object.keys(query.variables)

  if (variableNames.length === 0) {
    return { ...query, query: document }
  }

  const fragmentsWithVariables = new Set()

  document = visit(
    document,
    visitInParallel([
      // Note: visitInParallel によるノード編集の扱い方のため、順序が重要である
      Visitors.detectFragmentsWithVariables(fragmentsWithVariables),
      Visitors.prefixVariables(prefix),
    ])
  )

  if (fragmentsWithVariables.size > 0) {
    // 変数を持つすべてのフラグメントとスプレッドに接頭辞を付ける
    // フラグメントスプレッドはどの階層にも現れ得るので、残念ながらもう 1 回走査する必要がある
    // （ただし、変数を持つフラグメントは比較的まれである）
    document = visit(
      document,
      Visitors.prefixFragmentNames(prefix, fragmentsWithVariables),
      {
        [Kind.DOCUMENT]: [`definitions`],
        [Kind.OPERATION_DEFINITION]: [`selectionSet`],
        [Kind.FRAGMENT_DEFINITION]: [`selectionSet`],
        [Kind.INLINE_FRAGMENT]: [`selectionSet`],
        [Kind.FIELD]: [`selectionSet`],
        [Kind.SELECTION_SET]: [`selections`],
      }
    )
  }

  const prefixedVariables = variableNames.reduce((acc, name) => {
    acc[prefix + name] = query.variables[name]
    return acc
  }, {})

  return {
    query: document,
    variables: prefixedVariables,
  }
}

/**
 * クエリのトップレベルのフィールドに、接頭辞付きのエイリアスを追加する。
 *
 * @see 実装の詳細は aliasFieldsInSelection を参照
 */
function aliasTopLevelFields(prefix, doc) {
  const transformer = {
    [Kind.OPERATION_DEFINITION]: def => {
      const { selections } = def.selectionSet
      return {
        ...def,
        selectionSet: {
          ...def.selectionSet,
          selections: aliasFieldsInSelection(prefix, selections, doc),
        },
      }
    },
  }
  return visit(doc, transformer, { [Kind.DOCUMENT]: [`definitions`] })
}

/**
 * セレクションのフィールドにエイリアスを追加する。インラインフラグメントのトップレベルのフィールドも含む。
 * フラグメントスプレッドはインラインフラグメントに変換され、そのトップレベルのフィールドにもエイリアスが付く。
 *
 * このメソッドは浅い処理である点に注意。エイリアスを追加するのはトップレベルのフィールドだけで、
 * フィールドのサブセレクションには降りていかない。
 *
 * たとえば、次のものを:
 *   {
 *     foo
 *     ... on Query { foo }
 *     ...FragmentWithBarField
 *   }
 * 次のように変換する:
 *   {
 *     gatsby1_foo: foo
 *     ... on Query { gatsby1_foo: foo }
 *     ... on Query { gatsby1_bar: bar }
 *   }
 */
function aliasFieldsInSelection(prefix, selections, document) {
  return _.flatMap(selections, selection => {
    switch (selection.kind) {
      case Kind.INLINE_FRAGMENT:
        return [aliasFieldsInInlineFragment(prefix, selection, document)]
      case Kind.FRAGMENT_SPREAD: {
        const inlineFragment = inlineFragmentSpread(selection, document)
        return [
          addSkipDirective(selection),
          aliasFieldsInInlineFragment(prefix, inlineFragment, document),
        ]
      }
      case Kind.FIELD:
      default:
        return [aliasField(selection, prefix)]
    }
  })
}

function addSkipDirective(node) {
  const skipDirective = {
    kind: Kind.DIRECTIVE,
    name: { kind: Kind.NAME, value: `skip` },
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: { kind: Kind.NAME, value: `if` },
        value: { kind: Kind.BOOLEAN, value: true },
      },
    ],
  }
  return {
    ...node,
    directives: [skipDirective],
  }
}

/**
 * インラインフラグメントのトップレベルのフィールドにエイリアスを追加する。
 * 新しいインラインフラグメントのノードを返す。
 *
 * たとえば、次のものを:
 *   ... on Query { foo, ... on Query { bar: foo } }
 * 次のように変換する:
 *   ... on Query { gatsby1_foo: foo, ... on Query { gatsby1_bar: foo } }
 */
function aliasFieldsInInlineFragment(prefix, fragment, document) {
  const { selections } = fragment.selectionSet
  return {
    ...fragment,
    selectionSet: {
      ...fragment.selectionSet,
      selections: aliasFieldsInSelection(prefix, selections, document),
    },
  }
}

/**
 * フラグメントスプレッドをインラインフラグメントに置き換える
 *
 * 例:
 *   query { ...Spread }
 *   fragment Spread on Query { bar }
 *
 * 次のように変換される:
 *   query { ... on Query { bar } }
 */
function inlineFragmentSpread(spread, document) {
  const fragment = document.definitions.find(
    def =>
      def.kind === Kind.FRAGMENT_DEFINITION &&
      def.name.value === spread.name.value
  )
  if (!fragment) {
    throw new Error(`Fragment ${spread.name.value} does not exist`)
  }
  const { typeCondition, selectionSet } = fragment
  return {
    kind: Kind.INLINE_FRAGMENT,
    typeCondition,
    selectionSet,
    directives: spread.directives,
  }
}

function prefixNodeName(namedNode, prefix) {
  return {
    ...namedNode,
    name: {
      ...namedNode.name,
      value: prefix + namedNode.name.value,
    },
  }
}

/**
 * 接頭辞付きのエイリアスを持つ新しい FieldNode を返す
 *
 * 例。prefix === "gatsby1_" の場合、次のように変換する:
 *   { foo } -> { gatsby1_foo: foo }
 *   { foo: bar } -> { gatsby1_foo: bar }
 */
function aliasField(field, aliasPrefix) {
  const aliasNode = field.alias ? field.alias : field.name
  return {
    ...field,
    alias: {
      ...aliasNode,
      value: aliasPrefix + aliasNode.value,
    },
  }
}

function isQueryDefinition(def) {
  return def.kind === Kind.OPERATION_DEFINITION && def.operation === `query`
}

function isFragmentDefinition(def) {
  return def.kind === Kind.FRAGMENT_DEFINITION
}
