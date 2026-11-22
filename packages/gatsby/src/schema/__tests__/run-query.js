const { store } = require(`../../redux`)
const { actions } = require(`../../redux/actions`)
const { getDataStore } = require(`../../datastore`)

const makeNodesUneven = () => [
  // 注: これはノード数が奇数であることを前提にしている
  {
    id: `0`,
    internal: { type: `Test`, contentDigest: `0` },
    index: 0,
    name: `The Mad Max`,
    string: `a`,
    float: 1.5,
    hair: 1,
    date: `2006-07-22T22:39:53.000Z`,
    anArray: [1, 2, 3, 4],
    strArray: `["testing", "serialization", "hacks"]`,
    nullArray: [1, null, 3, 4],
    duplicates: [`foo`],
    key: {
      withEmptyArray: [],
    },
    anotherKey: {
      withANested: {
        nestedKey: `foo`,
        emptyArray: [],
        anotherEmptyArray: [],
      },
    },
    frontmatter: {
      date: `2006-07-22T22:39:53.000Z`,
      title: `The world of dash and adventure`,
      tags: [`moo`, `foo`],
      blue: 100,
    },
    anObjectArray: [
      { aString: `some string`, aNumber: 2, aBoolean: true },
      { aString: `some string`, aNumber: 2, anArray: [1, 2] },
    ],
    boolean: true,
    nil: `not null`,
    nestedRegex: {
      field: `har har`,
    },
    num_null_not: 1,
    num_not_null: 1,
    null_num_not: null,
    null_not_num: null,
    str_null_not: `x`,
    str_not_null: `x`,
    null_str_not: null,
    null_not_str: null,
    obj_null_not: { y: 5 },
    obj_not_null: { y: 5 },
    null_obj_not: null,
    null_not_obj: null,
    exh: 2,
  },
  {
    id: `1`,
    internal: { type: `Test`, contentDigest: `0` },
    index: 1,
    name: `The Mad Wax`,
    string: `b`,
    float: 2.5,
    hair: 2,
    anArray: [1, 2, 5, 4],
    singleArray: [8],
    strArray: `[5,6,7,8]`,
    nullArray: [1, 3, 4],
    duplicates: `bar`,
    waxOnly: {
      foo: true,
      bar: { baz: true },
    },
    anotherKey: {
      withANested: {
        nestedKey: `foo`,
      },
    },
    frontmatter: {
      date: `2006-07-22T22:39:53.000Z`,
      title: `The world of slash and adventure`,
      blue: 10010,
      circle: `happy`,
    },
    boolean: false,
    nil: null,
    undef: undefined,
    singleElem: {
      things: [
        {
          one: {
            two: {
              three: 123,
            },
          },
        },
        {
          one: {
            five: {
              three: 153,
            },
          },
        },
        {
          one: {
            two: {
              three: 404,
            },
          },
        },
      ],
    },
    nestedRegex: {
      field: ``,
    },
    strSecondOnly: `needle`,
    boolSecondOnly: false,
    num_null_not: null,
    null_num_not: 1,
    not_null_num: null,
    not_num_null: 1,
    str_null_not: null,
    null_str_not: `x`,
    not_null_str: null,
    not_str_null: `x`,
    obj_null_not: null,
    null_obj_not: { y: 5 },
    not_null_obj: null,
    not_obj_null: { y: 5 },
    exh: 3,
  },
  {
    id: `2`,
    internal: { type: `Test`, contentDigest: `0` },
    index: 2,
    name: `The Mad Wax`,
    string: `c`,
    float: 3.5,
    hair: 0,
    date: `2006-07-29T22:39:53.000Z`,
    waxOnly: null,
    duplicates: [`foo`, `bar`],
    anotherKey: {
      withANested: {
        nestedKey: `bar`,
      },
    },
    frontmatter: {
      date: `2006-07-22T22:39:53.000Z`,
      title: `The world of shave and adventure`,
      blue: 10010,
      circle: `happy`,
    },
    data: {
      tags: [
        {
          tag: {
            document: [
              {
                data: {
                  tag: `Gatsby`,
                },
              },
            ],
          },
        },
        {
          tag: {
            document: [
              {
                data: {
                  tag: `Design System`,
                },
                number: 5,
              },
            ],
          },
        },
      ],
    },
    num_not_null: null,
    null_not_num: 1,
    not_null_num: 1,
    not_num_null: null,
    str_not_null: null,
    null_not_str: `x`,
    not_null_str: `x`,
    not_str_null: null,
    obj_not_null: null,
    null_not_obj: { y: 5 },
    not_null_obj: { y: 5 },
    not_obj_null: null,
    exh: 1,
  },
]
const makeNodesEven = () => [
  // lt/lte/gt/gte の検索をテストするために、意図的にノード数を偶数にしている
  {
    id: `0`,
    internal: { type: `Test`, contentDigest: `0` },
    exh: 2,
  },
  {
    id: `1`,
    internal: { type: `Test`, contentDigest: `1` },
    exh: 4,
  },
  {
    id: `2`,
    internal: { type: `Test`, contentDigest: `2` },
    exh: 1,
  },
  {
    id: `3`,
    internal: { type: `Test`, contentDigest: `3` },
    exh: 3,
  },
]

const makeNodesNeNull = () => [
  // このノードの集合では、対象のパスの途中の各段階に null のプロパティや
  // 存在しないプロパティがある場合の `ne` の動作を確認する。
  {
    id: `0`,
    internal: { type: `Test`, contentDigest: `0` },
    desc: `does not have the property chain at all`,
  },
  {
    id: `1`,
    internal: { type: `Test`, contentDigest: `1` },
    desc: `first start of path is null`,
    a: null,
    b: true,
    c: false,
  },
  {
    id: `2`,
    internal: { type: `Test`, contentDigest: `2` },
    desc: `second start of path is undefined`,
    a: {},
    b: true,
  },
  {
    id: `3`,
    internal: { type: `Test`, contentDigest: `3` },
    desc: `second start of path is null`,
    a: { b: null },
    b: true,
    c: true,
  },
  {
    id: `4`,
    internal: { type: `Test`, contentDigest: `4` },
    desc: `third part is undefined`,
    a: { b: {} },
  },
  {
    id: `5`,
    internal: { type: `Test`, contentDigest: `5` },
    desc: `third part is null`,
    a: { b: { c: null } },
  },
  {
    id: `6`,
    internal: { type: `Test`, contentDigest: `6` },
    desc: `third part is true`,
    a: { b: { c: true } },
  },
  {
    id: `7`,
    internal: { type: `Test`, contentDigest: `7` },
    desc: `third part is false`,
    a: { b: { c: false } },
  },
  {
    id: `8`,
    internal: { type: `Test`, contentDigest: `8` },
    desc: `first step is a bool (would be prevented by schema in real world) `,
    a: true,
  },
  {
    id: `9`,
    internal: { type: `Test`, contentDigest: `9` },
    desc: `second step is a bool (would be prevented by schema in real world)`,
    a: { b: true },
  },
]

const makeNodesMultiFilter = () => [
  {
    id: `1`,
    internal: { type: `Test`, contentDigest: `1` },
    locale: `en`,
    author: 1,
    date: `2021-08-06`,
    category: `foo`,
  },
  {
    id: `2`,
    internal: { type: `Test`, contentDigest: `2` },
    locale: `en`,
    author: 2,
    date: `2021-08-07`,
    category: `foo`,
  },
  {
    id: `3`,
    internal: { type: `Test`, contentDigest: `3` },
    locale: `it`,
    author: 1,
    date: `2021-08-07`,
    category: `foo`,
  },
  {
    id: `4`,
    internal: { type: `Test`, contentDigest: `4` },
    locale: `it`,
    author: 1,
    date: `2021-08-08`,
    category: `foo`,
  },
]

function make100Nodes(even) {
  const arr = []

  for (let i = 0; i < (even ? 100 : 99); ++i) {
    arr.push({
      id: String(i),
      internal: { type: `Test`, contentDigest: `a${i}b` },
      exh: i + 1,
    })
  }

  return arr
}

function makeGqlType(nodes) {
  const { createSchemaComposer } = require(`../../schema/schema-composer`)
  const { addInferredFields } = require(`../infer/add-inferred-fields`)
  const { addNodes } = require(`../infer/inference-metadata`)
  const { getExampleObject } = require(`../infer/build-example-data`)

  const sc = createSchemaComposer()
  const typeName = `Test`
  const tc = sc.createObjectTC(typeName)
  const inferenceMetadata = addNodes({ typeName }, nodes)
  addInferredFields({
    schemaComposer: sc,
    typeComposer: tc,
    exampleValue: getExampleObject(inferenceMetadata),
  })
  return { sc, type: tc.getType() }
}

async function resetDb(nodes) {
  store.dispatch({ type: `DELETE_CACHE` })
  nodes.forEach(node =>
    actions.createNode(node, { name: `test` })(store.dispatch)
  )
  await getDataStore().ready()
}

async function runQuery(queryArgs, nodes = makeNodesUneven()) {
  await resetDb(nodes)
  const { sc, type: gqlType } = makeGqlType(nodes)
  const args = {
    gqlType,
    firstOnly: false,
    queryArgs,
    gqlComposer: sc,
    nodeTypeNames: [gqlType.name],
    filtersCache: new Map(),
  }
  const { entries } = await getDataStore().runQuery(args)
  return Array.from(entries)
}

async function runQuery2(queryArgs) {
  const nodes = makeNodesUneven()
  return [await runQuery(queryArgs, nodes), nodes]
}

async function runFilter(filter) {
  return await runQuery2({ filter })
}

describe(`Filter fields`, () => {
  describe(`none`, () => {
    it(`handles empty filter`, async () => {
      const [result, allNodes] = await runFilter({})

      // すべてのノードが返るはずである
      expect(result?.length).toEqual(allNodes.length)
    })
  })

  describe(`$eq`, () => {
    it(`handles eq operator with number value`, async () => {
      const needle = 2
      const [result, allNodes] = await runFilter({
        hair: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair).toEqual(needle))
    })

    it(`handles eq operator with false value`, async () => {
      const needle = false
      const [result, allNodes] = await runFilter({
        boolean: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.boolean === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.boolean).toEqual(needle))
    })

    it(`handles eq operator with 0`, async () => {
      const needle = 0
      const [result, allNodes] = await runFilter({
        hair: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair).toEqual(needle))
    })

    it(`handles eq operator with null`, async () => {
      const needle = null // 注: これは null または undefined のノードを見つけるはずである（どうやら）
      const [result, allNodes] = await runFilter({
        nil: { eq: needle },
      })

      // そのプロパティをまったく持たないノード（db では NULL）も返す
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil == needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.nil == null).toEqual(true))
    })

    // grapqhl が `undefined` を渡してくることはない
    // it(`handles eq operator with undefined`, async () => {
    //   const [result, allNodes] = await runFastFilter{ undef: { eq: undefined } })
    //
    //   expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // result should contain unique elements
    //   expect(result.length).toEqual(?)
    //   expect(result[0].hair).toEqual(?)
    // })

    it(`handles eq operator with serialized array value`, async () => {
      const needle = `[5,6,7,8]`
      const [result, allNodes] = await runFilter({
        strArray: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.strArray === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.strArray).toEqual(needle))
    })

    it(`finds numbers inside arrays`, async () => {
      const needle = 3
      const [result, allNodes] = await runFilter({
        anArray: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.anArray?.includes(needle)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.anArray?.includes(needle)).toEqual(true)
      )
    })

    it(`finds numbers inside single-element arrays`, async () => {
      const needle = 8
      const [result, allNodes] = await runFilter({
        singleArray: { eq: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.singleArray?.includes(needle)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.singleArray?.includes(needle)).toEqual(true)
      )
    })

    it(`does not coerce numbers against single-element arrays`, async () => {
      const needle = `8` // 注: `('8' == [8]) === true`
      const [result] = await runFilter({
        singleArray: { eq: needle },
      })

      // 注: 型の強制はしない。[8]=='8' は true だが、ここでの比較は厳密である
      expect(result).toEqual([])
    })
  })

  describe(`$ne`, () => {
    it(`handles ne operator`, async () => {
      const needle = 2
      const [result, allNodes] = await runFilter({
        hair: { ne: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair).not.toEqual(needle))
    })

    it(`coerces number to string`, async () => {
      const needle = 2 // 注: `id` は数値の文字列である
      const [result, allNodes] = await runFilter({ id: { ne: needle } })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.id !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.id).not.toEqual(needle))
    })

    // このテストは現状ではスタックオーバーフローを起こす
    it.skip(`dpes not coerce string to number`, async () => {
      const needle = `2` // 注: `id` は数値の文字列である
      const [result] = await runFilter({ id: { hair: needle } })

      // 結果が空になるので、低速なフィルターになる
      expect(result).toEqual(null)
    })

    it(`handles ne operator with true`, async () => {
      const needle = true
      const [result, allNodes] = await runFilter({
        boolean: { ne: true },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.boolean !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.boolean).not.toEqual(needle))
    })

    describe(`exhaustive checks for null and partial paths`, () => {
      // このテスト群は、パス a.b.c=value に対して $ne を使ったときに、パスが途中までしかない
      // ノード（途中で null または undefined で終わるノード）で何が起きるかを、パスのすべての途中段階について網羅的に確認する。

      it(`should deal with eq null`, async () => {
        const needle = null
        const allNodes = makeNodesNeNull()
        const result = await runQuery(
          { filter: { a: { b: { c: { ne: needle } } } } },
          allNodes
        )

        // 歴史的な理由により、厳密な確認を適用する。a.b.c===true/false である id=6,7 だけを返す。

        expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
        expect(result?.length).toEqual(
          allNodes.filter(node => !(node?.a?.b?.c == null)).length
        )
        expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
        result.forEach(node => expect(node?.a?.b?.c).not.toEqual(needle))
      })

      it(`should deal with eq true`, async () => {
        const needle = true
        const allNodes = makeNodesNeNull()
        const result = await runQuery(
          { filter: { a: { b: { c: { ne: needle } } } } },
          allNodes
        )

        // 歴史的な理由により、厳密な確認を適用する。a.b.c===true である id=6 だけを除外する（null を検索する場合とは逆）

        expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
        expect(result?.length).toEqual(
          allNodes.filter(node => node?.a?.b?.c !== needle).length
        )
        expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
        result.forEach(node => expect(node?.a?.b?.c).not.toEqual(needle))
      })

      it(`should deal with eq false`, async () => {
        const needle = false
        const allNodes = makeNodesNeNull()
        const result = await runQuery(
          { filter: { a: { b: { c: { ne: needle } } } } },
          allNodes
        )

        // 歴史的な理由により、厳密な確認を適用する。a.b.c===false である id=7 だけを除外する（null を検索する場合とは逆）

        expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
        expect(result?.length).toEqual(
          allNodes.filter(node => node?.a?.b?.c !== needle).length
        )
        expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
        result.forEach(node => expect(node?.a?.b?.c).not.toEqual(needle))
      })
    })

    it(`handles nested ne operator with true`, async () => {
      const needle = true
      const [result, allNodes] = await runFilter({
        waxOnly: { foo: { ne: true } },
      })

      // 注: 1 つのノードはこれを持ち、1 つのノードは waxOnly=null で、1 つのノードは waxOnly プロパティをまったく持たない。
      // Redux は、プロパティをまったく持たないノード（node.id=0）だけを返すようだ
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.waxOnly?.foo !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.waxOnly?.foo).not.toEqual(needle))
    })

    it(`handles ne operator with 0`, async () => {
      const needle = 0
      const [result, allNodes] = await runFilter({
        hair: { ne: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair).not.toEqual(needle))
    })

    it(`handles ne operator with null`, async () => {
      const needle = 0
      const [result, allNodes] = await runFilter({
        nil: { ne: needle },
      })

      // プロパティを持ち、かつ null に設定されていないノードだけを返すはずである
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.nil).not.toEqual(needle))
    })

    // grapqhl が `undefined` を渡してくることはない
    // it(`handles ne operator with undefined`, async () => {
    //   const [result, allNodes] = await runFastFilter({ undef: { ne: undefined } })
    //
    //   expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // result should contain unique elements
    //   expect(result.length).toEqual(?)
    //   expect(result?.length).toEqual(allNodes.filter(node => node.nil !== needle).length)
    //   expect(result?.length).toBeGreaterThan(0) // Make sure there _are_ results, don't let this be zero
    //   result.forEach(node => expect(node.nil).not.toEqual(needle))
    // })

    it(`handles deeply nested ne: true operator`, async () => {
      const needle = true
      const [result, allNodes] = await runFilter({
        waxOnly: { bar: { baz: { ne: needle } } },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.waxOnly?.bar?.baz !== needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.waxOnly?.bar?.baz).not.toEqual(needle))
    })

    it(`handles the ne operator for array field values`, async () => {
      const needle = 1
      const [result, allNodes] = await runFilter({
        anArray: { ne: needle },
      })

      // 歴史的な理由により、プロパティをまったく持たないノードだけを返す（他の 2 つの配列は 1 を含む）

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => !node.anArray?.includes(needle)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.anArray?.includes(needle)).not.toEqual(true)
      )
    })
  })

  describe(`$lt`, () => {
    it(`handles lt operator with number`, async () => {
      const needle = 1
      const [result, allNodes] = await runFilter({
        hair: { lt: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair < needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair < needle).toEqual(true))
    })

    async function confirmPosition(allNodes, needle) {
      const result = await runQuery(
        { filter: { exh: { lt: needle } } },
        allNodes
      )

      // 報告された件数が実際の件数と等しいかだけを確認する
      // デバッグしやすいように "hint" を先頭に付ける。こうすると、偶数か奇数かと needle が分かる
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length ?? 0).toEqual(
        allNodes.filter(node => node.exh < needle).length
      )
      if (result) result.forEach(node => expect(node.exh < needle))
    }

    ;[`uneven`, `even`].forEach(count => {
      describe(`positional checks for count=` + count, () => {
        for (let i = 0; i <= 5; i += 0.5) {
          it(
            `should be able to lt anywhere in an array i=` + i.toFixed(1),
            async () => {
              // 偶数個または奇数個の、順序付きのノードの一覧のすべての位置で op をテストする。`exh` は 1,2,3,4 か 1,2,3 のどちらかにしかならない
              // 順序付きの検索について、一覧のそれぞれの位置の前、位置そのもの、位置の間、位置の後を確認する
              await confirmPosition(
                count === `even` ? makeNodesEven() : makeNodesUneven(),
                i
              )
            }
          )
        }

        // 注: needle のプロパティは 1 から 99 または 100 までの範囲である。needle は存在しない値にすべきである。存在すると二分探索が
        // 完全にスキップされる。このテストは、約 100 個のノードで needle が見つからない場合の op を検証しようとしている。
        for (const needle of [
          0, 1.5, 33.5, 49.5, 50.5, 66.5, 98.5, 99.5, 100.5,
        ]) {
          it(`should pivot upward when needle does not exist, needle=${needle}`, async () => {
            // これは、次のピボットのインデックスを誤って生成していた二分探索アルゴリズムのバグを検出した。
            await confirmPosition(make100Nodes(count === `even`), needle)
          })
        }
      })
    })

    // 注: このテストは現在スタックオーバーフローを起こす
    it.skip(`should lt when type coercion fails direct value lookup`, async () => {
      // ここでは 1.5 は存在するが、数値としてだけである。しかし、`1.5 < '1.5' === true` である
      // このテストは、値がマップされていなければ見つからない、と
      // 誤って決めつけていないかを確認する。
      const needle = `1.5`
      const [result, allNodes] = await runFilter({
        float: { lt: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.float < needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.float < needle).toEqual(true))
    })

    it(`handles lt operator with null`, async () => {
      const needle = null
      // 注: 結果が空になるので、低速なフィルターになる
      const [result, allNodes] = await runFilter({
        nil: { lt: needle },
      })

      // null より小さいものはないので、一致するノードは 0 個のはずである
      // （注: これは、ここで null を返す `lte` とは異なる）
      expect(result).toEqual([])
      expect(
        allNodes.filter(node => node.nil === needle).length
      ).toBeGreaterThan(0) // これらは _存在する_ はずである...
    })
  })

  describe(`$lte`, () => {
    it(`handles lte operator with number`, async () => {
      const needle = 1
      const [result, allNodes] = await runFilter({
        hair: { lte: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair <= needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair <= needle).toEqual(true))
    })

    async function confirmPosition(allNodes, needle) {
      const result = await runQuery(
        { filter: { exh: { lte: needle } } },
        allNodes
      )

      // 報告された件数が実際の件数と等しいかだけを確認する
      // デバッグしやすいように "hint" を先頭に付ける。こうすると、偶数か奇数かと needle が分かる
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length ?? 0).toEqual(
        allNodes.filter(node => node.exh <= needle).length
      )
      if (result) result.forEach(node => expect(node.exh <= needle))
    }

    ;[`uneven`, `even`].forEach(count => {
      describe(`positional checks for count=` + count, () => {
        for (let i = 0; i <= 5; i += 0.5) {
          it(
            `should be able to lte anywhere in an array i=` + i.toFixed(1),
            async () => {
              // 偶数個または奇数個の、順序付きのノードの一覧のすべての位置で op をテストする。`exh` は 1,2,3,4 か 1,2,3 のどちらかにしかならない
              // 順序付きの検索について、一覧のそれぞれの位置の前、位置そのもの、位置の間、位置の後を確認する
              await confirmPosition(
                count === `even` ? makeNodesEven() : makeNodesUneven(),
                i
              )
            }
          )
        }

        // 注: needle のプロパティは 1 から 99 または 100 までの範囲である。needle は存在しない値にすべきである。存在すると二分探索が
        // 完全にスキップされる。このテストは、約 100 個のノードで needle が見つからない場合の op を検証しようとしている。
        for (const needle of [
          0, 1.5, 33.5, 49.5, 50.5, 66.5, 98.5, 99.5, 100.5,
        ]) {
          it(`should pivot upward when needle does not exist, needle=${needle}`, async () => {
            // これは、次のピボットのインデックスを誤って生成していた二分探索アルゴリズムのバグを検出した。
            await confirmPosition(make100Nodes(count === `even`), needle)
          })
        }
      })
    })

    // 注: このテストは現在スタックオーバーフローを起こす
    it.skip(`should lte when type coercion fails direct value lookup`, async () => {
      // ここでは 1.5 は存在するが、数値としてだけである。しかし、`1.5 <= '1.5' === true` である
      // このテストは、値がマップされていなければ見つからない、と
      // 誤って決めつけていないかを確認する。
      const needle = `1.5`
      const [result, allNodes] = await runFilter({
        float: { lte: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.float <= needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.float <= needle).toEqual(true))
    })

    it(`handles lte operator with null`, async () => {
      const needle = null
      const [result, allNodes] = await runFilter({
        nil: { lte: needle },
      })

      // lte null は null に一致するが、プロパティを持たないノード（NULL）には一致しない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.nil === needle).toEqual(true))
    })
  })

  describe(`$gt`, () => {
    it(`handles gt operator with number`, async () => {
      const needle = 1
      const [result, allNodes] = await runFilter({
        hair: { gt: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair > needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair > needle).toEqual(true))
    })

    async function confirmPosition(allNodes, needle) {
      const result = await runQuery(
        { filter: { exh: { gt: needle } } },
        allNodes
      )

      // 報告された件数が実際の件数と等しいかだけを確認する
      // デバッグしやすいように "hint" を先頭に付ける。こうすると、偶数か奇数かと needle が分かる
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length ?? 0).toEqual(
        allNodes.filter(node => node.exh > needle).length
      )
      if (result) result.forEach(node => expect(node.exh > needle))
    }

    ;[`uneven`, `even`].forEach(count => {
      describe(`positional checks for count=` + count, () => {
        for (let i = 0; i <= 5; i += 0.5) {
          it(
            `should be able to gt anywhere in an array i=` + i.toFixed(1),
            async () => {
              // 偶数個または奇数個の、順序付きのノードの一覧のすべての位置で op をテストする。`exh` は 1,2,3,4 か 1,2,3 のどちらかにしかならない
              // 順序付きの検索について、一覧のそれぞれの位置の前、位置そのもの、位置の間、位置の後を確認する
              await confirmPosition(
                count === `even` ? makeNodesEven() : makeNodesUneven(),
                i
              )
            }
          )
        }

        // 注: needle のプロパティは 1 から 99 または 100 までの範囲である。needle は存在しない値にすべきである。存在すると二分探索が
        // 完全にスキップされる。このテストは、約 100 個のノードで needle が見つからない場合の op を検証しようとしている。
        for (const needle of [
          0, 1.5, 33.5, 49.5, 50.5, 66.5, 98.5, 99.5, 100.5,
        ]) {
          it(`should pivot upward when needle does not exist, needle=${needle}`, async () => {
            // これは、次のピボットのインデックスを誤って生成していた二分探索アルゴリズムのバグを検出した。
            await confirmPosition(make100Nodes(count === `even`), needle)
          })
        }
      })
    })

    // 注: このテストは現在スタックオーバーフローを起こす
    it.skip(`should gt when type coercion fails direct value lookup`, async () => {
      // ここでは 1.5 は存在するが、数値としてだけである。しかし、`1.5 < '1.5' === true` である
      // このテストは、値がマップされていなければ見つからない、と
      // 誤って決めつけていないかを確認する。
      const needle = `1.5`
      const [result, allNodes] = await runFilter({
        float: { gt: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.float > needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.float > needle).toEqual(true))
    })

    it(`handles gt operator with null`, async () => {
      const needle = null
      // 注: 結果が空になるので、低速なフィルターになる
      const [result, allNodes] = await runFilter({
        nil: { gt: needle },
      })

      // null より大きいものはないので、一致するノードは 0 個のはずである
      // （注: これは、ここで null を返す `gte` とは異なる）
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result).toEqual([])
      expect(
        allNodes.filter(node => node.nil === needle).length
      ).toBeGreaterThan(0) // これらは _存在する_ はずである...
    })
  })

  describe(`$gte`, () => {
    it(`handles gte operator with number`, async () => {
      const needle = 1
      const [result, allNodes] = await runFilter({
        hair: { gte: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.hair >= needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.hair >= needle).toEqual(true))
    })

    async function confirmPosition(allNodes, needle) {
      const result = await runQuery(
        { filter: { exh: { gte: needle } } },
        allNodes
      )

      // 報告された件数が実際の件数と等しいかだけを確認する
      // デバッグしやすいように "hint" を先頭に付ける。こうすると、偶数か奇数かと needle が分かる
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length ?? 0).toEqual(
        allNodes.filter(node => node.exh >= needle).length
      )
      if (result) result.forEach(node => expect(node.exh >= needle))
    }

    ;[`uneven`, `even`].forEach(count => {
      describe(`positional checks for count=` + count, () => {
        for (let i = 0; i <= 5; i += 0.5) {
          it(
            `should be able to gte anywhere in an array i=` + i.toFixed(1),
            async () => {
              // 偶数個または奇数個の、順序付きのノードの一覧のすべての位置で op をテストする。`exh` は 1,2,3,4 か 1,2,3 のどちらかにしかならない
              // 順序付きの検索について、一覧のそれぞれの位置の前、位置そのもの、位置の間、位置の後を確認する
              await confirmPosition(
                count === `even` ? makeNodesEven() : makeNodesUneven(),
                i
              )
            }
          )
        }

        // 注: needle のプロパティは 1 から 99 または 100 までの範囲である。needle は存在しない値にすべきである。存在すると二分探索が
        // 完全にスキップされる。このテストは、約 100 個のノードで needle が見つからない場合の op を検証しようとしている。
        for (const needle of [
          0, 1.5, 33.5, 49.5, 50.5, 66.5, 98.5, 99.5, 100.5,
        ]) {
          it(`should pivot upward when needle does not exist, needle=${needle}`, async () => {
            // これは、次のピボットのインデックスを誤って生成していた二分探索アルゴリズムのバグを検出した。
            await confirmPosition(make100Nodes(count === `even`), needle)
          })
        }
      })
    })

    // 注: このテストは現在スタックオーバーフローを起こす
    it.skip(`should gte when type coercion fails direct value lookup`, async () => {
      // ここでは 1.5 は存在するが、数値としてだけである。しかし、`1.5 < '1.5' === true` である
      // このテストは、値がマップされていなければ見つからない、と
      // 誤って決めつけていないかを確認する。
      const needle = `1.5`
      const [result, allNodes] = await runFilter({
        float: { gte: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.float >= needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.float >= needle).toEqual(true))
    })

    it(`handles gte operator with null`, async () => {
      const needle = null
      const [result, allNodes] = await runFilter({
        nil: { gte: needle },
      })

      // gte null は null に一致するが、プロパティを持たないノード（NULL）には一致しない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil === needle).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.nil === needle).toEqual(true))
    })
  })

  describe(`$regex`, () => {
    it(`handles the regex operator without flags`, async () => {
      const needleStr = `/^The.*Wax/`
      const needleRex = /^The.*Wax/
      const [result, allNodes] = await runFilter({
        name: { regex: needleStr },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needleRex.test(node.name)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needleRex.test(node.name)).toEqual(true))
    })

    it(`handles the regex operator with i-flag`, async () => {
      // 注: needle は確認に使う値と異なる。`new RegExp('/a/i')` は _動かない_ ためである
      const needleRex = /^the.*wax/i
      const needleStr = `/^the.*wax/i`
      const [result, allNodes] = await runFilter({
        name: { regex: needleStr },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needleRex.test(node.name)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needleRex.test(node.name)).toEqual(true))
    })

    it(`rejects strings without forward slashes`, async () => {
      await expect(
        runFilter({
          name: { regex: `^The.*Wax` },
        })
      ).rejects.toThrow()
    })

    it(`rejects strings without trailing slash`, async () => {
      await expect(
        runFilter({
          name: { regex: `/^The.*Wax` },
        })
      ).rejects.toThrow()
    })

    it(`accepts strings without leading slash`, async () => {
      // このテストが失敗するようになっても問題ないかもしれず、その場合は削除してよい。
      // これを書いた時点では、Sift の現状のエッジケースだった

      // これは通る。この要件は主に、他の失敗ケースで .split() が失敗することに
      // 関するものだからである。最終的に正規表現を渡してさえいれば、
      // あまり気にしたり検証したりする必要はない。

      const needleRex = /(?:)/i // これは最終的にこうなった
      const needleStr = `^the.*wax/i`
      const [result, allNodes] = await runFilter({
        name: { regex: needleStr },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needleRex.test(node.name)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needleRex.test(node.name)).toEqual(true))
    })

    it(`rejects actual regex`, async () => {
      await expect(
        runFilter({
          name: { regex: /^The.*Wax/ },
        })
      ).rejects.toThrow()
    })

    it(`handles the nested regex operator and ignores partial paths`, async () => {
      const needleStr = `/.*/`
      const needleRex = /.*/
      const [result, allNodes] = await runFilter({
        nestedRegex: { field: { regex: needleStr } },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(
          node =>
            node.nestedRegex !== undefined &&
            node.nestedRegex.field !== undefined &&
            needleRex.test(node.nestedRegex.field)
        ).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(
          node.nestedRegex === undefined ||
            needleRex.test(node.nestedRegex.field)
        ).toEqual(true)
      )
    })

    it(`does not match double quote for string without it`, async () => {
      const [result, allNodes] = await runFilter({
        name: { regex: `/"/` },
      })

      expect(result).toEqual([])
      expect(allNodes.filter(node => node.name === `"`).length).toEqual(0)
    })
  })

  describe(`$in`, () => {
    it(`handles the in operator for strings`, async () => {
      const needle = [`b`, `c`]
      const [result, allNodes] = await runFilter({
        string: { in: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needle.includes(node.string)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needle.includes(node.string)).toEqual(true))
    })

    it(`handles the in operator for ints`, async () => {
      const needle = [0, 2]
      const [result, allNodes] = await runFilter({
        index: { in: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needle.includes(node.index)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needle.includes(node.index)).toEqual(true))
    })

    it(`handles the in operator for floats`, async () => {
      const needle = [1.5, 2.5]
      const [result, allNodes] = await runFilter({
        float: { in: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => needle.includes(node.float)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(needle.includes(node.float)).toEqual(true))
    })

    it(`handles the in operator for just null`, async () => {
      const [result, allNodes] = await runFilter({
        nil: { in: [null] },
      })

      // プロパティを持たないか、null でなければならない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil === undefined || node.nil === null)
          .length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.nil === undefined || node.nil === null).toEqual(true)
      )
    })

    it(`handles the in operator for double null`, async () => {
      const [result, allNodes] = await runFilter({
        nil: { in: [null, null] },
      })

      // プロパティを持たないか、null でなければならない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil === undefined || node.nil === null)
          .length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.nil === undefined || node.nil === null).toEqual(true)
      )
    })

    it(`handles the in operator for null in int and null`, async () => {
      const [result, allNodes] = await runFilter({
        nil: { in: [5, null] },
      })

      // `nil` プロパティを持たないノードも含める
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.nil === undefined || node.nil === null)
          .length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(node.nil === undefined || node.nil === null).toEqual(true)
      )
    })

    it(`handles the in operator for int in int and null`, async () => {
      const [result, allNodes] = await runFilter({
        index: { in: [2, null] },
      })

      // `index` プロパティを持たないノードも含める（そのようなノードはない）
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(
          node =>
            node.index === undefined || node.index === null || node.index === 2
        ).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(
          node.index === undefined || node.index === null || node.index === 2
        ).toEqual(true)
      )
    })

    it(`handles the in operator for booleans`, async () => {
      const [result, allNodes] = await runFilter({
        boolean: { in: [true] },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.boolean === true).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.boolean === true).toEqual(true))
    })

    it(`handles the in operator for array with one element`, async () => {
      // 注: `node.anArray` は存在しないか、複数の数値の配列である
      const [result, allNodes] = await runFilter({
        anArray: { in: [5] },
      })

      // 1 番目は 5 を含み、2 番目は 5 を含まず、3 番目はプロパティを
      // まったく持たない（NULL）。1 番目と最後を返すはずである。
      // （対象の値に `null` がある場合は、3 番目は除外されるはずである）
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.anArray?.includes(5)).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node.anArray?.includes(5)).toEqual(true))
    })

    it(`handles the in operator for array some elements`, async () => {
      // 注: `node.anArray` は存在しないか、複数の数値の配列である
      const needle = [20, 5, 300]
      const [result, allNodes] = await runFilter({
        anArray: { in: needle },
      })

      // `[5]` だけの場合のテストと同じ。20 と 300 はどこにも現れない。
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node => node.anArray?.some(n => needle.includes(n)))
          .length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(
          node.anArray && needle.some(n => node.anArray.includes(n))
        ).toEqual(true)
      )
    })

    it(`handles the in operator and return a unique list even if multiple requested elements match the same array`, async () => {
      const needle = [1, 2] // 両方の要素がそれぞれのノードの ainArray のリストに現れるが、それでも各ノードは 1 回だけ返すはずである
      const [result, allNodes] = await runFilter({
        anArray: { in: needle },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      // `[5]` だけの場合のテストと同じ。20 と 300 はどこにも現れない。
      expect(result?.length).toEqual(
        allNodes.filter(node => node.anArray?.some(n => needle.includes(n)))
          .length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(
          node.anArray && needle.some(n => node.anArray.includes(n))
        ).toEqual(true)
      )
    })

    it(`handles the nested in operator for array of strings`, async () => {
      const needle = [`moo`]
      const [result, allNodes] = await runFilter({
        frontmatter: { tags: { in: needle } },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result?.length).toEqual(
        allNodes.filter(node =>
          node.frontmatter.tags?.some(n => needle.includes(n))
        ).length
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node =>
        expect(
          node.frontmatter?.tags &&
            needle.some(n => node.frontmatter.tags.includes(n))
        ).toEqual(true)
      )
    })

    it(`sorts correctly`, async () => {
      const needle = [`foo`, `bar`]
      const result = await runQuery({
        filter: { duplicates: { in: needle } },
        sort: { fields: [`id`], order: [] },
      })
      expect(result.map(r => r.id)).toEqual([`0`, `1`, `2`])
    })

    it(`refuses a non-arg number argument`, async () => {
      await expect(
        runFilter({
          hair: { in: 2 },
        })
      ).rejects.toThrow()
    })

    // これが Sift で動いていたのは、まぐれにすぎなかったと確信している
    it.skip(`refuses a non-arg string argument`, async () => {
      await expect(
        runFilter({
          name: { in: `The Mad Max` },
        })
      ).rejects.toThrow()
    })

    it(`refuses a non-arg boolean argument`, async () => {
      await expect(
        runFilter({
          boolean: { in: true },
        })
      ).rejects.toThrow()
    })
  })

  describe(`$elemMatch`, () => {
    it(`handles the elemMatch operator on a proper single tree`, async () => {
      const [result] = await runFilter({
        singleElem: {
          things: {
            elemMatch: {
              one: {
                two: {
                  three: { eq: 123 },
                },
              },
            },
          },
        },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(
        result[0]?.singleElem?.things.some(e => e?.one?.two?.three === 123)
      ).toEqual(true)
    })

    it(`handles the elemMatch operator on the second element`, async () => {
      const [result] = await runFilter({
        singleElem: {
          things: {
            elemMatch: {
              one: {
                five: {
                  three: { eq: 153 },
                },
              },
            },
          },
        },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      // 1 つしか一致しなくても、配列全体が含まれるはずである
      expect(result[0].singleElem.things[0].one.two.three).toEqual(123)
      expect(result[0].singleElem.things[1].one.five.three).toEqual(153)
    })

    it(`should return only one node if elemMatch hits multiples`, async () => {
      const [result] = await runFilter({
        singleElem: {
          things: {
            elemMatch: {
              one: {
                two: {
                  three: { lt: 1000 }, // 一致する一方は 123、もう一方は 404
                },
              },
            },
          },
        },
      })

      // `elemMatch` 演算子は、一致した最初のノードだけを返す。そのため、
      // `lt 1000` は `things` 配列の 2 つの要素に一致するが、
      // 返すノードは 1 つである。
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].singleElem.things[0].one.two.three).toEqual(123)
      expect(result[0].singleElem.things[2].one.two.three).toEqual(404)
    })

    it(`ignores the elemMatch operator on a partial sub tree`, async () => {
      const [result] = await runFilter({
        singleElem: {
          things: {
            elemMatch: {
              three: { eq: 123 },
            },
          },
        },
      })

      expect(result).toEqual([])
    })

    it(`handles the elemMatch operator for array of objects (1)`, async () => {
      const [result] = await runFilter({
        data: {
          tags: {
            elemMatch: {
              tag: {
                document: {
                  elemMatch: {
                    data: {
                      tag: { eq: `Gatsby` },
                    },
                  },
                },
              },
            },
          },
        },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].index).toEqual(2)
    })

    it(`handles the elemMatch operator for array of objects (2)`, async () => {
      const [result] = await runFilter({
        data: {
          tags: {
            elemMatch: {
              tag: {
                document: {
                  elemMatch: {
                    data: {
                      tag: { eq: `Design System` },
                    },
                  },
                },
              },
            },
          },
        },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].index).toEqual(2)
    })

    it(`works for elemMatch on boolean field`, async () => {
      const [result] = await runFilter({
        boolean: {
          elemMatch: {
            eq: true,
          },
        },
      })

      // そのフィールドを持たないノードは含まれない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].boolean).toEqual(true)
    })

    it(`skips nodes without the field for elemMatch on boolean`, async () => {
      const [result] = await runFilter({
        boolSecondOnly: {
          elemMatch: {
            eq: false,
          },
        },
      })

      // そのフィールドを持たないノードは含まれないので、2 番目のノードを返す
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].boolSecondOnly).toEqual(false)
    })

    it(`works for elemMatch on string field`, async () => {
      const [result] = await runFilter({
        string: {
          elemMatch: {
            eq: `a`,
          },
        },
      })

      // そのフィールドを持たないノードは含まれない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].string).toEqual(`a`)
    })

    it(`should return all nodes for elemMatch on non-arrays too`, async () => {
      const [result] = await runFilter({
        name: {
          elemMatch: {
            eq: `The Mad Wax`,
          },
        },
      })

      // 複数のノードを返すことがある
      // そのフィールドを持たないノードは含まれない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      expect(result[0].name).toEqual(`The Mad Wax`)
      expect(result[1].name).toEqual(`The Mad Wax`)
    })

    it(`skips nodes without the field for elemMatch on string`, async () => {
      const [result] = await runFilter({
        strSecondOnly: {
          elemMatch: {
            eq: `needle`,
          },
        },
      })

      // そのフィールドを持たないノードは含まれないので、2 番目のノードを返す
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].strSecondOnly).toEqual(`needle`)
    })

    it(`works for elemMatch on number field`, async () => {
      const [result] = await runFilter({
        float: {
          elemMatch: {
            eq: 1.5,
          },
        },
      })

      // そのフィールドを持たないノードは含まれない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].float).toEqual(1.5)
    })
  })

  describe(`$nin`, () => {
    it(`handles the nin operator for array [5]`, async () => {
      const [result] = await runFilter({ anArray: { nin: [5] } })

      // 配列に `null` が含まれないので、クエリは、そのフィールドを
      // まったく持たないノード（NULL）も返すはずである。

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      // 存在しないか、含んでいないかのどちらか
      result
        .filter(node => node.anArray !== undefined)
        .forEach(node => {
          // このテストでは、プロパティが存在する場合は配列であるはずである
          expect(Array.isArray(node.anArray)).toBe(true)
          expect(node.anArray.includes(5)).toBe(false)
        })
    })

    it(`handles the nin operator for array [null]`, async () => {
      const [result] = await runFilter({
        nullArray: { nin: [null] },
      })

      // 配列に `null` が含まれるので、クエリは、そのフィールドを
      // まったく持たないノード（NULL）を返さないはずである。

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      expect(result[0].nullArray.includes(null)).toBe(false)
    })

    it(`handles the nin operator for strings`, async () => {
      const [result] = await runFilter({
        string: { nin: [`b`, `c`] },
      })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      result.forEach(node => {
        expect(node.string).not.toEqual(`b`)
        expect(node.string).not.toEqual(`c`)
      })
    })

    it(`handles the nin operator for ints`, async () => {
      const [result] = await runFilter({ index: { nin: [0, 2] } })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      result.forEach(node => {
        expect(node.index).not.toEqual(0)
        expect(node.index).not.toEqual(2)
      })
    })

    it(`handles the nin operator for floats`, async () => {
      const [result] = await runFilter({ float: { nin: [1.5] } })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      result.forEach(node => {
        // プロパティを持たなくてもよい（-> undefined）。1.5 であってはならない
        expect(node.float).not.toEqual(1.5)
      })
    })

    it(`handles the nin operator for boolean and null on boolean`, async () => {
      const [result] = await runFilter({
        boolean: { nin: [true, null] },
      })

      // `null` があるので、そのフィールドを持たないノードは返さない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      result.forEach(node => {
        // プロパティを持っていなければならず、true でも null でもあってはならない
        expect(node.boolean !== undefined).toBe(true)
        expect(node.boolean !== true && node.boolean !== null).toBe(true)
      })
    })

    it(`handles the nin operator for double null`, async () => {
      const [result] = await runFilter({
        nil: { nin: [null, null] },
      })

      // `null` があるので、そのフィールドを持たないノードは返さない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      result.forEach(node => {
        // プロパティを持っていなければならず、null であってはならない
        expect(node.nil !== undefined).toBe(true)
        expect(node.nil !== null).toBe(true)
      })
    })

    it(`handles the nin operator for null in int+null`, async () => {
      const [result] = await runFilter({
        nil: { nin: [5, null] },
      })

      // `null` があるので、そのフィールドを持たないノードは返さない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(1)
      result.forEach(node => {
        // プロパティを持っていなければならず、5 でも null でもあってはならない
        expect(node.nil !== undefined).toBe(true)
        expect(node.nil !== 5 && node.nil !== null).toBe(true)
      })
    })

    it(`handles the nin operator for int in int+null`, async () => {
      const [result] = await runFilter({
        index: { nin: [2, null] },
      })

      // `null` があるので、そのフィールドを持たないノードは返さない
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      result.forEach(node => {
        // プロパティを持っていなければならず、2 でも null でもあってはならない
        expect(node.index !== undefined).toBe(true)
        expect(node.index !== 2 && node.index !== null).toBe(true)
      })
    })
  })

  describe(`$glob`, () => {
    // 注: glob は内部で $regex を使う

    it(`handles the glob operator`, async () => {
      const [result] = await runFilter({ name: { glob: `*Wax` } })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      expect(result[0].name).toEqual(`The Mad Wax`)
    })
  })

  describe(`date`, () => {
    it(`filters date fields`, async () => {
      const [result] = await runFilter({ date: { ne: null } })

      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result.length).toEqual(2)
      expect(result[0].index).toEqual(0)
      expect(result[1].index).toEqual(2)
    })
  })
})

describe(`Multiple filter fields`, () => {
  let nodes
  beforeEach(() => {
    nodes = makeNodesMultiFilter()
  })

  describe(`$eq + $eq`, () => {
    it(`supports simple query`, async () => {
      const result = await runQuery(
        {
          filter: {
            author: { eq: 1 },
            locale: { eq: `en` },
          },
        },
        nodes
      )
      expect(result).toEqual([nodes[0]])
    })
  })

  describe(`$ne + $ne`, () => {
    it(`should deal with ne null on both fields`, async () => {
      const needle = null
      const allNodes = makeNodesNeNull()
      const result = await runQuery(
        {
          filter: {
            b: { ne: needle },
            c: { ne: needle },
          },
        },
        allNodes
      )
      expect(result?.length ?? 0).toEqual(new Set(result ?? []).size) // 結果の要素は重複していないはずである
      expect(result).toEqual(
        allNodes.filter(node => node?.b != null && node?.c != null)
      )
      expect(result?.length).toBeGreaterThan(0) // 結果が _存在する_ ことを確認する。0 件であってはならない
      result.forEach(node => expect(node?.b).not.toEqual(needle))
      result.forEach(node => expect(node?.c).not.toEqual(needle))
    })
  })

  describe(`$eq + $gte`, () => {
    it(`supports simple query`, async () => {
      const result = await runQuery(
        {
          filter: {
            locale: { eq: `en` },
            date: { gte: `2021-08-06` },
          },
        },
        nodes
      )
      const ids = result.map(n => n.id)
      expect(ids).toEqual([`1`, `2`])
    })

    it(`supports query with sort by a different field`, async () => {
      const result = await runQuery(
        {
          filter: {
            locale: { eq: `en` },
            date: { gte: `2021-08-06` },
          },
          sort: {
            fields: [`author`],
            order: [`DESC`],
          },
        },
        nodes
      )
      const ids = result.map(n => n.id)
      expect(ids).toEqual([`2`, `1`])
    })
  })

  // TODO:
  describe(`$eq + $in`, () => {})
  describe(`$eq + $lt`, () => {})
  describe(`$eq + $gt + $lt`, () => {})
  describe(`$in + $in`, () => {})
  describe(`$in + $gt`, () => {})
  describe(`$gt + $gt`, () => {})
  describe(`$gt + $lt`, () => {})
})

describe(`collection fields`, () => {
  it(`orders by given field desc with limit`, async () => {
    const result = await runQuery({
      limit: 10,
      sort: {
        fields: [`frontmatter.blue`],
        order: [`desc`],
      },
    })

    expect(result.length).toEqual(3)

    // ノード 1 と 2 はどちらも値が 10010 なので、正しいソート順は定まらない
    //  LMDB は、主となるソートに加えて実際には node.counter でもソートするが、
    //  古い高速フィルターは二次的なソートを一切しないので、違いが出る
    if (process.env.GATSBY_EXPERIMENTAL_LMDB_INDEXES) {
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    } else {
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    }
  })

  describe(`num, null, and nullable order`, () => {
    // このスイートは、数値のフィールド、明示的に値 `null` が設定された
    // フィールド、設定されていないフィールド（データベースでは NULL になる）の
    // 間の順序を確認する。redux と同じ動作をするはずである。
    // 網羅的なスイート。2^3 x2 = 12 個のテストで、すべてのケースを asc と desc で確認する

    // node 1  2   3
    //  - num_null_not    1 番目のノードはフィールドが設定され、2 番目は null が設定され、3 番目は未設定
    //  - num_not_null    以下同様
    //  - null_num_not
    //  - null_not_num
    //  - not_null_num
    //  - not_num_null

    it(`sorts num_null_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`num_null_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts num_null_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`num_null_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts num_not_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`num_not_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts num_not_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`num_not_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts null_num_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_num_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts null_num_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_num_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_num asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_num`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_num desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_num`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_null_num asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_num`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_null_num desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_num`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_num_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_num_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_num_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_num_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })
  })

  describe(`string, null, and nullable order`, () => {
    // このスイートは、文字列のフィールド、明示的に値 `null` が設定された
    // フィールド、設定されていないフィールド（データベースでは NULL になる）の
    // 間の順序を確認する。redux と同じ動作をするはずである。
    // 網羅的なスイート。2^3 x2 = 12 個のテストで、すべてのケースを asc と desc で確認する

    // node 1  2   3
    //  - str_null_not    1 番目のノードはフィールドが設定され、2 番目は null が設定され、3 番目は未設定
    //  - str_not_null    以下同様
    //  - null_str_not
    //  - null_not_str
    //  - not_null_str
    //  - not_str_null

    it(`sorts str_null_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`str_null_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts str_null_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`str_null_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts str_not_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`str_not_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts str_not_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`str_not_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts null_str_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_str_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts null_str_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_str_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_str asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_str`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_str desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_str`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_null_str asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_str`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_null_str desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_str`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_str_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_str_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_str_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_str_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })
  })

  describe(`obj, null, and nullable order`, () => {
    // このスイートは、オブジェクトのフィールド、明示的に値 `null` が設定された
    // フィールド、設定されていないフィールド（データベースでは NULL になる）の
    // 間の順序を確認する。redux と同じ動作をするはずである。
    // 網羅的なスイート。2^3 x2 = 12 個のテストで、すべてのケースを asc と desc で確認する

    // node 1  2   3
    //  - obj_null_not    1 番目のノードはフィールドが設定され、2 番目は null が設定され、3 番目は未設定
    //  - obj_not_null    以下同様
    //  - null_obj_not
    //  - null_not_obj
    //  - not_null_obj
    //  - not_obj_null

    it(`sorts obj_null_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`obj_null_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts obj_null_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`obj_null_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts obj_not_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`obj_not_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts obj_not_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`obj_not_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts null_obj_not asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_obj_not`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts null_obj_not desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_obj_not`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_obj asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_obj`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`1`)
    })

    it(`sorts null_not_obj desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`null_not_obj`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`0`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_null_obj asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_obj`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`2`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_null_obj desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_null_obj`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`1`)
      expect(result[2].id).toEqual(`2`)
    })

    it(`sorts not_obj_null asc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_obj_null`],
          order: [`asc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`1`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`0`)
    })

    it(`sorts not_obj_null desc`, async () => {
      const result = await runQuery({
        sort: {
          fields: [`not_obj_null`],
          order: [`desc`],
        },
      })

      expect(result.length).toEqual(3)
      expect(result[0].id).toEqual(`0`)
      expect(result[1].id).toEqual(`2`)
      expect(result[2].id).toEqual(`1`)
    })
  })

  it(`sorts results with desc has null fields first vs obj second`, async () => {
    const result = await runQuery({
      limit: 10,
      sort: {
        fields: [`waxOnly`],
        order: [`desc`],
      },
    })

    // 0 はそれを持たず、1 はオブジェクトとして持ち、2 は null として持つ

    expect(result.length).toEqual(3)
    expect(result[0].id).toEqual(`0`)
    expect(result[1].id).toEqual(`2`)
    expect(result[2].id).toEqual(`1`)
  })

  it(`sorts results with asc has null fields last vs obj first`, async () => {
    const result = await runQuery({
      limit: 10,
      sort: {
        fields: [`waxOnly`],
        order: [`asc`],
      },
    })

    // 0 はそれを持たず、1 はオブジェクトとして持ち、2 は null として持つ

    expect(result.length).toEqual(3)
    expect(result[0].id).toEqual(`1`)
    expect(result[1].id).toEqual(`2`)
    expect(result[2].id).toEqual(`0`)
  })

  it(`applies specified sort order, and sorts asc by default`, async () => {
    const result = await runQuery({
      limit: 10,
      sort: {
        fields: [`frontmatter.blue`, `id`],
        order: [`desc`], // `id` フィールドは昇順でソートされる
      },
    })

    expect(result.length).toEqual(3)
    expect(result[0].id).toEqual(`1`) // blue = 10010, id = 1
    expect(result[1].id).toEqual(`2`) // blue = 10010, id = 2
    expect(result[2].id).toEqual(`0`) // blue = 100, id = 0
  })

  it(`applies specified sort order per field`, async () => {
    const result = await runQuery({
      limit: 10,
      sort: {
        fields: [`frontmatter.blue`, `id`],
        order: [`desc`, `desc`], // `id` フィールドは降順でソートされる
      },
    })

    expect(result.length).toEqual(3)
    expect(result[0].id).toEqual(`2`) // blue = 10010, id = 2
    expect(result[1].id).toEqual(`1`) // blue = 10010, id = 1
    expect(result[2].id).toEqual(`0`) // blue = 100, id = 0
  })
})
