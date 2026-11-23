const { sourceNodes } = require(`../gatsby-node`)

describe(`gatsby-source-faker`, () => {
  const actions = {}
  let createNodeId
  let createContentDigest

  const pluginOptions = {
    schema: {
      name: [`firstName`, `lastName`],
    },
    count: 3, // 必要なフェイクオブジェクトの数
    type: `NameData`, // graphql のクエリノードの名前
  }

  beforeEach(() => {
    actions.createNode = jest.fn()
    createNodeId = jest.fn(() => `id`)
    createContentDigest = jest.fn(() => `digest`)
    sourceNodes({ actions, createNodeId, createContentDigest }, pluginOptions)
  })

  it(`should create nodes based on faker generated values`, () => {
    expect(actions.createNode).toHaveBeenNthCalledWith(pluginOptions.count, {
      children: [],
      id: `id`,
      internal: {
        type: pluginOptions.type,
        contentDigest: `digest`,
      },
      parent: null,
      name: {
        firstName: expect.any(String),
        lastName: expect.any(String),
      },
    })
  })

  it(`should not print faker's deprecation warnings`, () => {
    const log = jest.spyOn(console, `log`).mockImplementation(() => {})
    const warn = jest.spyOn(console, `warn`).mockImplementation(() => {})

    sourceNodes({ actions, createNodeId, createContentDigest }, pluginOptions)

    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    log.mockRestore()
    warn.mockRestore()
  })
})
