const { actions } = require(`../../redux/actions`)
const { store } = require(`../../redux`)
const { getDataStore, getNode, getNodes } = require(`..`)

const report = require(`gatsby-cli/lib/reporter`)
jest.mock(`gatsby-cli/lib/reporter`)

describe(`nodes db tests`, () => {
  beforeEach(() => {
    store.dispatch({ type: `DELETE_CACHE` })
  })

  it(`deletes previously transformed children nodes when the parent node is updated`, async () => {
    store.dispatch(
      actions.createNode(
        {
          id: `hi`,
          children: [],
          parent: null,
          internal: {
            contentDigest: `hasdfljds`,
            type: `Test`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1`,
          children: [],
          parent: `hi`,
          internal: {
            contentDigest: `hasdfljds-1`,
            type: `Test-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi`),
          child: getNode(`hi-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1-1`,
          children: [],
          parent: `hi-1`,
          internal: {
            contentDigest: `hasdfljds-1-1`,
            type: `Test-1-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi-1`),
          child: getNode(`hi-1-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi`,
          children: [],
          parent: `test`,
          internal: {
            contentDigest: `hasdfljds2`,
            type: `Test`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    await getDataStore().ready()
    expect(getNodes()).toHaveLength(1)
  })

  it(`deletes previously transformed children nodes when the parent node is deleted`, async () => {
    store.dispatch(
      actions.createNode(
        {
          id: `hi`,
          children: [],
          parent: `test`,
          internal: {
            contentDigest: `hasdfljds`,
            type: `Test`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi2`,
          children: [],
          parent: `test`,
          internal: {
            contentDigest: `hasdfljds`,
            type: `Test`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1`,
          children: [],
          parent: `hi`,
          internal: {
            contentDigest: `hasdfljds-1`,
            type: `Test-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi`),
          child: getNode(`hi-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1-1`,
          children: [],
          parent: `hi-1`,
          internal: {
            contentDigest: `hasdfljds-1-1`,
            type: `Test-1-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi-1`),
          child: getNode(`hi-1-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.deleteNode(getNode(`hi`), {
        name: `tests`,
      })
    )
    await getDataStore().ready()
    expect(getNodes()).toHaveLength(1)
  })

  it(`deletes previously transformed children nodes when parent nodes are deleted`, () => {
    store.dispatch(
      actions.createNode(
        {
          id: `hi`,
          children: [],
          parent: `test`,
          internal: {
            contentDigest: `hasdfljds`,
            type: `Test`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1`,
          children: [],
          parent: `hi`,
          internal: {
            contentDigest: `hasdfljds-1`,
            type: `Test-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi`),
          child: getNode(`hi-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createNode(
        {
          id: `hi-1-1`,
          children: [],
          parent: `hi-1`,
          internal: {
            contentDigest: `hasdfljds-1-1`,
            type: `Test-1-1`,
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.createParentChildLink(
        {
          parent: getNode(`hi-1`),
          child: getNode(`hi-1-1`),
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(
      actions.deleteNode(getNode(`hi`), {
        name: `tests`,
      })
    )
    expect(getNodes()).toHaveLength(0)
  })

  it(`allows deleting nodes`, () => {
    store.dispatch(
      actions.createNode(
        {
          id: `hi`,
          children: [],
          parent: `test`,
          internal: {
            contentDigest: `hasdfljds`,
            type: `Test`,
          },
          pickle: true,
          deep: {
            array: [
              0,
              1,
              {
                boom: true,
              },
            ],
          },
        },
        {
          name: `tests`,
        }
      )
    )
    store.dispatch(actions.deleteNode(getNode(`hi`)))
    expect(getNode(`hi`)).toBeUndefined()
  })

  it(`throws an error when trying to delete a node of a type owned from another plugin`, () => {
    expect(() => {
      store.dispatch(
        actions.createNode(
          {
            id: `hi`,
            children: [],
            parent: `test`,
            internal: {
              contentDigest: `hasdfljds`,
              type: `Other`,
            },
          },
          {
            name: `other`,
          }
        )
      )
      store.dispatch(
        actions.deleteNode(getNode(`hi`), {
          name: `tests`,
        })
      )
    }).toThrow(/deleted/)
  })

  it(`does not crash when delete node is called on undefined`, () => {
    actions.deleteNode(undefined, {
      name: `tests`,
    })
    expect(getNodes()).toHaveLength(0)
  })

  it(`records the node type owner when a node is created`, async () => {
    // ノードを作成する
    store.dispatch(
      actions.createNode(
        {
          id: `1`,
          internal: {
            type: `OwnerOneTestTypeOne`,
            contentDigest: `ok`,
          },
        },
        {
          name: `test-owner-1`,
        }
      )
    )
    // 同じ型で 2 つ目のノードを作成する
    store.dispatch(
      actions.createNode(
        {
          id: `2`,
          internal: {
            type: `OwnerOneTestTypeOne`,
            contentDigest: `ok`,
          },
        },
        {
          name: `test-owner-1`,
        }
      )
    )

    // 型は異なるが同じプラグインによる 3 つ目のノード
    store.dispatch(
      actions.createNode(
        {
          id: `3`,
          internal: {
            type: `OwnerOneTestTypeTwo`,
            contentDigest: `ok`,
          },
        },
        {
          name: `test-owner-1`,
        }
      )
    )

    // 別のプラグインによる 4 つ目のノード
    store.dispatch(
      actions.createNode(
        {
          id: `4`,
          internal: {
            type: `OwnerTwoTestTypeThree`,
            contentDigest: `ok`,
          },
        },
        {
          name: `test-owner-2`,
        }
      )
    )

    // 2 つ目のプラグインによる 5 つ目のノード。ただしこのノードは削除される。削除されたノードにも型の所有者は残る
    const nodeFive = {
      id: `5`,
      internal: {
        type: `OwnerTwoTestTypeFour`,
        contentDigest: `ok`,
      },
    }
    store.dispatch(
      actions.createNode(nodeFive, {
        name: `test-owner-2`,
      })
    )
    store.dispatch(
      actions.deleteNode(nodeFive, {
        name: `test-owner-2`,
      })
    )
    expect(getNode(`5`)).toBeUndefined()

    const state = store.getState()

    const ownerOne = state.typeOwners.pluginsToTypes.get(`test-owner-1`)
    expect(ownerOne).toBeTruthy()
    expect(ownerOne.has(`OwnerOneTestTypeOne`)).toBeTrue()
    expect(ownerOne.has(`OwnerOneTestTypeTwo`)).toBeTrue()
    expect(ownerOne.has(`OwnerTwoTestTypeThree`)).toBeFalse()

    const ownerTwo = state.typeOwners.pluginsToTypes.get(`test-owner-2`)
    expect(ownerTwo).toBeTruthy()
    expect(ownerTwo.has(`OwnerOneTestTypeTwo`)).toBeFalse()
    expect(ownerTwo.has(`OwnerTwoTestTypeThree`)).toBeTrue()
    expect(ownerTwo.has(`OwnerTwoTestTypeFour`)).toBeTrue()
  })
})
