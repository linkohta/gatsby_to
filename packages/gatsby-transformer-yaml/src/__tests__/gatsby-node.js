const Promise = require(`bluebird`)
const os = require(`os`)
const { onCreateNode } = require(`../gatsby-node`)

const createNodeId = jest.fn().mockReturnValue(`uuid-from-gatsby`)
const createContentDigest = jest.fn().mockReturnValue(`contentDigest`)

const loadNodeContent = node => Promise.resolve(node.content)

let createNode
let createParentChildLink
let actions
let node
let createNodeSpec

beforeEach(() => {
  createNode = jest.fn()
  createParentChildLink = jest.fn()
  actions = { createNode, createParentChildLink }

  node = {
    id: `whatever`,
    parent: null,
    children: [],
    internal: {
      contentDigest: `whatever`,
      mediaType: `text/yaml`,
    },
  }

  createNodeSpec = {
    node,
    loadNodeContent,
    actions,
    createNodeId,
    createContentDigest,
  }
})

const expectCreatedNodesMatchingSnapshot = count => {
  expect(createNode.mock.calls).toMatchSnapshot()
  expect(createParentChildLink.mock.calls).toMatchSnapshot()
  expect(createNode).toHaveBeenCalledTimes(count)
  expect(createParentChildLink).toHaveBeenCalledTimes(count)
}

const expectCreatedNodeTypeName = nodeTypeName => {
  expect(createNode).toHaveBeenCalledWith(
    expect.objectContaining({
      internal: expect.objectContaining({
        type: nodeTypeName,
      }),
    })
  )
}

describe(`Processing YAML nodes with internal type 'File'`, () => {
  beforeEach(() => {
    node.internal.type = `File`
    node.dir = `${os.tmpdir()}/top/foo bar/`
    node.name = `My File`
  })

  describe(`from a single YAML dictionary,`, () => {
    beforeEach(() => {
      node.content = `
            id: some
            blue: true
            funny: yup
      `
    })

    it(`when no target type name is specified, the type name is based on the directory name`, async () => {
      await onCreateNode(createNodeSpec)

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`FooBarYaml`)
    })

    it(`with the specified target type name`, async () => {
      await onCreateNode(createNodeSpec, {
        typeName: `fixed`,
      })

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`fixed`)
    })

    it(`with the target type name explicitly retrieved from the YAML content`, async () => {
      // noinspection JSUnusedLocalSymbols (unused fields left as documentation)
      await onCreateNode(createNodeSpec, {
        typeName: ({ node, object, isArray }) => object.funny,
      })

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`yup`)
    })
  })

  describe(`from a YAML array of dictionaries,`, () => {
    beforeEach(() => {
      node.content = `
            - blue: true
              funny: yup
            - blue: false
              funny: nope
      `
    })

    it(`when no target type name is specified, all nodes have a type name based on the file name`, async () => {
      await onCreateNode(createNodeSpec)

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`MyFileYaml`)
      expectCreatedNodeTypeName(`MyFileYaml`)
    })

    it(`with the specified target type name`, async () => {
      await onCreateNode(createNodeSpec, {
        typeName: `fixed`,
      })

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`fixed`)
      expectCreatedNodeTypeName(`fixed`)
    })

    it(`with the target type name explicitly retrieved from the YAML content`, async () => {
      // noinspection JSUnusedLocalSymbols (unused fields left as documentation)
      await onCreateNode(createNodeSpec, {
        typeName: ({ node, object, isArray }) => object.funny,
      })

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`yup`)
      expectCreatedNodeTypeName(`nope`)
    })
  })
})

describe(`Processing YAML nodes with internal type other than 'File'`, () => {
  beforeEach(() => {
    node.internal.type = `Other`
  })

  describe(`from a single YAML dictionary,`, () => {
    beforeEach(() => {
      node.content = `
            id: some
            blue: true
            funny: yup
      `
    })

    it(`when no target type name is specified, the type name is based on the original node's internal type`, async () => {
      await onCreateNode(createNodeSpec)

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`OtherYaml`)
    })

    it(`with the specified target type name`, async () => {
      await onCreateNode(createNodeSpec, {
        typeName: `fixed`,
      })

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`fixed`)
    })

    it(`with the target type name explicitly retrieved from the YAML content`, async () => {
      // noinspection JSUnusedLocalSymbols (unused fields left as documentation)
      await onCreateNode(createNodeSpec, {
        typeName: ({ node, object, isArray }) => object.funny,
      })

      expectCreatedNodesMatchingSnapshot(1)
      expectCreatedNodeTypeName(`yup`)
    })
  })

  describe(`from a YAML array of dictionaries,`, () => {
    beforeEach(() => {
      node.content = `
            - blue: true
              funny: yup
            - blue: false
              funny: nope
      `
    })

    it(`when no target type name is specified, all nodes have a type name based on the original node's internal type`, async () => {
      await onCreateNode(createNodeSpec)

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`OtherYaml`)
      expectCreatedNodeTypeName(`OtherYaml`)
    })

    it(`with the specified target type name`, async () => {
      await onCreateNode(createNodeSpec, {
        typeName: `fixed`,
      })

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`fixed`)
      expectCreatedNodeTypeName(`fixed`)
    })

    it(`with the target type name explicitly retrieved from the YAML content`, async () => {
      // noinspection JSUnusedLocalSymbols (unused fields left as documentation)
      await onCreateNode(createNodeSpec, {
        typeName: ({ node, object, isArray }) => object.funny,
      })

      expectCreatedNodesMatchingSnapshot(2)
      expectCreatedNodeTypeName(`yup`)
      expectCreatedNodeTypeName(`nope`)
    })
  })
})

describe(`Reading YAML content the same way as before js-yaml 5`, () => {
  beforeEach(() => {
    node.internal.type = `File`
    node.dir = `${os.tmpdir()}/bar/`
  })

  it(`keeps dates, merge keys and plain objects`, async () => {
    node.content = [
      `base: &base`,
      `  color: red`,
      `item:`,
      `  <<: *base`,
      `  size: 1`,
      `published: 2002-12-14`,
      `updated: 2001-12-14t21:59:43.10-05:00`,
      `answer: yes`,
      `time: 12:30:45`,
    ].join(`\n`)

    await onCreateNode(createNodeSpec)

    expect(createNode).toHaveBeenCalledTimes(1)
    const [createdNode] = createNode.mock.calls[0]
    expect(createdNode.item).toEqual({ color: `red`, size: 1 })
    expect(Object.getPrototypeOf(createdNode.item)).toBe(Object.prototype)
    expect(createdNode.published).toEqual(new Date(`2002-12-14T00:00:00.000Z`))
    expect(createdNode.updated).toEqual(new Date(`2001-12-15T02:59:43.100Z`))
    // YAML 1.1 の真偽値や 60 進数としては解釈しない
    expect(createdNode.answer).toBe(`yes`)
    expect(createdNode.time).toBe(`12:30:45`)
  })

  it.each([
    [`an empty file`, ``],
    [`a file with only comments`, `# nothing here\n`],
  ])(`creates no nodes and does not throw for %s`, async (_label, content) => {
    node.content = content

    await onCreateNode(createNodeSpec)

    expect(createNode).not.toHaveBeenCalled()
  })

  it(`throws for a file with more than one document`, async () => {
    node.content = `---\na: 1\n---\nb: 2\n`

    await expect(onCreateNode(createNodeSpec)).rejects.toThrow()
    expect(createNode).not.toHaveBeenCalled()
  })
})
