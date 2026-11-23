const { onCreateNode } = require(`../gatsby-node`)

describe(`Process TOML nodes correctly`, () => {
  const node = {
    id: `whatever`,
    parent: null,
    children: [],
    extension: `toml`,
    internal: {
      contentDigest: `whatever`,
    },
    name: `test`,
  }

  // ダミーの関数を用意する
  const loadNodeContent = node => Promise.resolve(node.content)

  it(`Correctly creates nodes from TOML test file`, async () => {
    // 残念ながら、TOML の制約のために JSON -> TOML のコンバーターは存在しない。
    // そのため、JS のテンプレートリテラルを使うしかない。
    node.content = `
    [the]
    test_string = "You'll hate me after this - #"

    [the.hard]
    test_array = [ "] ", " # "]      # ]
    test_array2 = [ "Test #11 ]proved that", "Experiment #9 was a success" ]
    another_test_string = " Same thing, but with a string #"
    harder_test_string = " And when \\"'s are in the string, along with # \\""
    # Things will get harder

        [the.hard."bit#"]
        "what?" = "You don't think some user won't do that?"
        multi_line_array = [
            "]",
            # ] Oh yes I did
            ]
    `

    const createNode = jest.fn()
    const createParentChildLink = jest.fn()
    const actions = { createNode, createParentChildLink }
    const createNodeId = jest.fn()
    createNodeId.mockReturnValue(`uuid-from-gatsby`)
    const createContentDigest = jest.fn().mockReturnValue(`contentDigest`)

    await onCreateNode({
      node,
      loadNodeContent,
      actions,
      createNodeId,
      createContentDigest,
    }).then(() => {
      expect(createNode.mock.calls).toMatchSnapshot()
      expect(createParentChildLink.mock.calls).toMatchSnapshot()
      expect(createNode).toHaveBeenCalledTimes(1)
      expect(createParentChildLink).toHaveBeenCalledTimes(1)
      expect(createContentDigest).toHaveBeenCalledTimes(1)
    })
  })

  it(`creates nodes whose nested fields are plain objects`, async () => {
    node.content = `
    title = "plain"
    date = 1979-05-27T07:32:00Z

    [table]
    inline = { key = 1 }

    [[items]]
    nested = { list = [ { deep = true } ] }
    `

    const createNode = jest.fn()
    const actions = { createNode, createParentChildLink: jest.fn() }

    await onCreateNode({
      node,
      loadNodeContent,
      actions,
      createNodeId: jest.fn().mockReturnValue(`uuid-from-gatsby`),
      createContentDigest: jest.fn().mockReturnValue(`contentDigest`),
    })

    const [createdNode] = createNode.mock.calls[0]
    const prototypes = []
    const collectPrototypes = value => {
      if (Array.isArray(value)) {
        value.forEach(collectPrototypes)
      } else if (
        value &&
        typeof value === `object` &&
        !(value instanceof Date)
      ) {
        prototypes.push(Object.getPrototypeOf(value))
        Object.values(value).forEach(collectPrototypes)
      }
    }
    collectPrototypes(createdNode)

    expect(prototypes.length).toBeGreaterThan(4)
    expect(prototypes.every(proto => proto === Object.prototype)).toBe(true)
    expect(createdNode.date).toBeInstanceOf(Date)
    expect(createdNode.table.inline.key).toBe(1)
    expect(createdNode.items[0].nested.list[0].deep).toBe(true)
  })

  // TOML トランスフォーマーは配列からサブオブジェクトを生成せず、
  // オブジェクトをそのまま使うので、サブオブジェクト間の 'id' の一意性のテストは
  // 省略している。
})
