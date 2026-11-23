/**
 * このテストスイートは、クエリ結果のキャッシュが正しく動くことを確認する。
 *
 * 確認する内容:
 *  - キャッシュが空の状態で実行したとき、gatsby が期待されるすべてのクエリを実行すること
 *  - 無効化されるべきクエリを gatsby が再実行すること
 *  - gatsby が不要なクエリを実行しないこと（キャッシュされたクエリを再利用する場合）
 * テストの基本的な構成:
 *  - キャッシュを消した後に gatsby がすべてのクエリを実行することを、念のため確認する
 *  - ノードを 1 つ変更してクエリを再実行し、期待したクエリだけが実行されたことを確認する
 *    - gatsby のプロセスを再起動しない場合（インメモリーのキャッシュに頼る）
 *    - gatsby のプロセスを再起動する場合（永続化されたキャッシュから読み込んだデータに頼る）
 *
 * このテストは、クエリの実行によって、トップレベルの connection と単一フィールドへのデータ依存が正しく追加されることを前提にしている
 * （それが正しいことの確認は、このテストスイートの対象ではない）。
 *
 * モックしている仕組み:
 *  - fs-extra（LMDB_STORE が有効でないときに、クエリ結果をファイルシステムへ書き込まないため）
 *  - cache-lmdb（LMDB_STORE が有効なときに、クエリ結果を lmdb へ書き込まないため）
 *  - reporter（テストランナーの出力を埋め尽くさないため）
 *  - api-runner-node（`sourceNodes` と `createPage` の API フックを動的に調整できるようにするため）
 *  - query-runner（実際にはモックしておらず、本物の query-runner を使っている。commonJS のデフォルト export にスパイを付ける方法として、見つけた中でこれが最もきれいだった）
 *
 * 懸念点:
 *  - `setup()` 関数は、このテストの実行時間を抑えるために、gatsby の機能の一部（bootstrap、develop、build コマンドの一部）を再実装している
 *     - gatsby の内部が変更されると、このテストにも追加の保守が必要になるかもしれない
 *     - 内部の変更の後、予期しない状況で誤検知を報告するかもしれない。
 */

jest.mock(`fs-extra`, () => {
  return {
    outputFile: jest.fn(),
    ensureDir: jest.fn(),
    readFileSync: jest.fn(() => `foo`), // createPage アクションは、`getServerData` を探すためにページテンプレートのファイルを読み込む
  }
})

jest.mock(`../../utils/cache-lmdb`, () => {
  return {
    default: class MockedCache {
      init() {
        return this
      }
      get = jest.fn(() => Promise.resolve())
      set = jest.fn(() => Promise.resolve())
    },
    __esModule: true,
  }
})

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
    panicOnBuild: console.log,
    activityTimer: () => {
      return {
        start: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      }
    },
    createProgress: () => {
      return {
        start: jest.fn(),
        tick: jest.fn(),
        end: jest.fn(),
      }
    },
    phantomActivity: () => {
      return {
        start: jest.fn(),
        setStatus: jest.fn(),
        end: jest.fn(),
      }
    },
  }
})

let mockPersistedState = {}
jest.mock(`../../redux/persist`, () => {
  return {
    readFromCache: () => mockPersistedState,
    writeToCache: state => {
      mockPersistedState = state
    },
  }
})

const pluginOptions = {}

let mockAPIs = {}
const setAPIhooks = hooks => (mockAPIs = { ...mockAPIs, ...hooks })

let pageQueries = {}
const setPageQueries = queries => (pageQueries = queries)

let staticQueries = {}
const setStaticQueries = queries => (staticQueries = queries)

const typedNodeCreator =
  (type, { createNode, createContentDigest }) =>
  node => {
    node.internal = {
      type,
      contentDigest: createContentDigest(node),
    }
    return createNode(node)
  }

const getTypedNodeCreators = ({
  actions: { createNode },
  createContentDigest,
}) => {
  return {
    createSiteNode: typedNodeCreator(`Site`, {
      createNode,
      createContentDigest,
    }),
    createTestNode: typedNodeCreator(`Test`, {
      createNode,
      createContentDigest,
    }),
    createTestBNode: typedNodeCreator(`TestB`, {
      createNode,
      createContentDigest,
    }),
    createNotUsedNode: typedNodeCreator(`NotUsed`, {
      createNode,
      createContentDigest,
    }),
    createFooNode: typedNodeCreator(`Foo`, {
      createNode,
      createContentDigest,
    }),
    createBarNode: typedNodeCreator(`Bar`, {
      createNode,
      createContentDigest,
    }),
  }
}

let isFirstRun = true
const setup = async ({ restart = isFirstRun, clearCache = false } = {}) => {
  if (restart) {
    jest.resetModules()
  } else if (clearCache) {
    console.error(`Can't clear cache without restarting`)
    process.exit(1)
  }

  jest.doMock(`../query-runner`, () => {
    const { queryRunner: actualQueryRunner } =
      jest.requireActual(`../query-runner`)
    return {
      queryRunner: jest.fn(actualQueryRunner),
    }
  })

  jest.doMock(`../../utils/api-runner-node`, () => apiName => {
    if (mockAPIs[apiName]) {
      return mockAPIs[apiName](
        {
          actions: doubleBoundActionCreators,
          schema: require(`../../schema/types/type-builders`),
          createContentDigest: require(`gatsby-core-utils`).createContentDigest,
        },
        pluginOptions
      )
    }
    return undefined
  })

  const queryUtil = require(`../`)
  const { store, emitter } = require(`../../redux`)
  const { saveState } = require(`../../redux/save-state`)
  const reporter = require(`gatsby-cli/lib/reporter`)
  const { bindActionCreators } = require(`redux`)
  const { queryRunner } = require(`../query-runner`)
  const { actions } = require(`../../redux/actions`)
  const boundActionCreators = bindActionCreators(actions, store.dispatch)

  const doubleBoundActionCreators = Object.keys(boundActionCreators).reduce(
    (acc, actionName) => {
      acc[actionName] = (...args) =>
        boundActionCreators[actionName](...args, {
          name: `gatsby-source-test`,
          version: `1.0.0`,
        })
      return acc
    },
    {}
  )
  const apiRunner = require(`../../utils/api-runner-node`)

  if (isFirstRun || clearCache) {
    mockPersistedState = {}
    store.dispatch({ type: `DELETE_CACHE` })
  }
  isFirstRun = false

  queryRunner.mockClear()

  store.dispatch({
    type: `SET_PROGRAM`,
    payload: {
      directory: __dirname,
    },
  })

  await require(
    `../../utils/create-schema-customization`
  ).createSchemaCustomization({})

  await require(`../../utils/source-nodes`).default({})
  // page-hot-reloader を起動する（前のテストでセットアップされていた場合）
  emitter.emit(`API_RUNNING_QUEUE_EMPTY`)

  if (restart) {
    await require(`../../schema`).build({})
  }

  await apiRunner(`createPages`)

  Object.entries(pageQueries).forEach(([componentPath, query]) => {
    store.dispatch({
      type: `QUERY_EXTRACTED`,
      payload: {
        componentPath,
        query,
      },
    })
  })

  Object.entries(staticQueries).forEach(([id, query]) => {
    // 実際のコードの動作に合わせて、静的クエリのテキストが変わったときだけこのアクションを呼ぶ
    const lastQuery = mockPersistedState.staticQueryComponents?.get(`sq--${id}`)
    if (lastQuery?.query !== query) {
      store.dispatch({
        type: `REPLACE_STATIC_QUERY`,
        payload: {
          id: `sq--${id}`,
          hash: `sq--${id}`,
          query,
        },
      })
    }
  })

  const queryIds = queryUtil.calcInitialDirtyQueryIds(store.getState())
  const { staticQueryIds, pageQueryIds } = queryUtil.groupQueryIds(queryIds)
  const activity = reporter.activityTimer(`query running`)
  activity.start()
  await queryUtil.processStaticQueries(staticQueryIds, {
    activity,
    state: store.getState(),
  })
  await queryUtil.processPageQueries(pageQueryIds, { activity })
  activity.end()

  await saveState()

  const idsOfQueriesThatRan = queryRunner.mock.calls.map(call => call[1].id)

  const pathsOfPagesWithQueriesThatRan = idsOfQueriesThatRan
    .filter(p => !p.startsWith(`sq--`))
    .sort()

  const staticQueriesThatRan = idsOfQueriesThatRan
    .filter(p => p.startsWith(`sq--`))
    .map(p => p.slice(4))
    .sort()

  return {
    pathsOfPagesWithQueriesThatRan,
    staticQueriesThatRan,
    pages: [...store.getState().pages.keys()].sort(),
  }
}

const indexBarFooArray = [`/`, `/bar/`, `/foo/`]

describe(`query caching between builds`, () => {
  beforeAll(() => {
    setAPIhooks({
      createPages: ({ actions: { createPage } }, _pluginOptions) => {
        createPage({
          component: `/src/templates/listing.js`,
          path: `/`,
          context: {},
        })

        createPage({
          component: `/src/templates/details.js`,
          path: `/foo`,
          context: {
            slug: `foo`,
          },
        })

        createPage({
          component: `/src/templates/details.js`,
          path: `/bar`,
          context: {
            slug: `bar`,
          },
        })
      },
    })
    setPageQueries({
      "/src/templates/listing.js": `
          {
            allTest {
              nodes {
                slug
                content
              }
            }
          }
        `,
      "/src/templates/details.js": `
          query($slug: String!) {
            test(slug: { eq: $slug}) {
              slug
              content
            }
          }
        `,
    })

    setStaticQueries({
      "static-query-1": `
          {
            site {
              siteMetadata {
                title
                description
              }
            }
          }
        `,
    })
  })

  describe(`Baseline`, () => {
    beforeAll(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createSiteNode, createTestNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo`,
            content: `Lorem ipsum.`,
          })
          createTestNode({
            id: `test-2`,
            slug: `bar`,
            content: `Dolor sit amet.`,
          })
          createSiteNode({
            id: `Site`,
            siteMetadata: {
              title: `My Site`,
              description: `Description of site`,
            },
          })
        },
      })
    })

    it(`first run - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual(indexBarFooArray)
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 99999)

    it(`rerunning without data changes and without restart shouldn't run any queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 変更がなければ、実行するクエリもないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 99999)

    it(`rerunning without data changes after restart shouldn't run any queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 変更がなければ、実行するクエリもないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 99999)

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
          clearCache: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual(indexBarFooArray)
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 99999)
  })

  describe(`Changed data node used for static query`, () => {
    let nodeChangeCounter = 1
    beforeEach(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createSiteNode, createTestNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo`,
            content: `Lorem ipsum.`,
          })
          createTestNode({
            id: `test-2`,
            slug: `bar`,
            content: `Dolor sit amet.`,
          })
          createSiteNode({
            id: `Site`,
            siteMetadata: {
              title: `My Site`,
              description: `Description of site

              --edited
              edited content #${nodeChangeCounter++}
              `,
            },
          })
        },
      })
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
          clearCache: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual(indexBarFooArray)
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 99999)

    it(`reruns only static query (no restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // ページクエリは 1 つも再実行されないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 999999)

    it(`reruns only static query (with restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // ページクエリは 1 つも再実行されないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 999999)
  })

  describe(`Changed data node used for pages`, () => {
    let nodeChangeCounter = 1
    beforeEach(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createSiteNode, createTestNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo`,
            content: `Lorem ipsum.`,
          })
          createTestNode({
            id: `test-2`,
            slug: `bar`,
            content: `Dolor sit amet.

            --edited
            edited content #${nodeChangeCounter++}
            `,
          })
          createSiteNode({
            id: `Site`,
            siteMetadata: {
              title: `My Site`,
              description: `Description of site`,
            },
          })
        },
      })
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
          clearCache: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual(indexBarFooArray)
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 99999)

    it(`reruns queries only for listing and detail page that uses that node (no restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // ノードを 1 つ変更したので、connection（`/`）と詳細ページ 1 つ（`/bar/`）が実行されるはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`, `/bar/`])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)

    it(`reruns queries only for listing and detail page that uses that node (with restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // ノードを 1 つ変更したので、connection（`/`）と詳細ページ 1 つ（`/bar/`）が実行されるはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`, `/bar/`])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)
  })

  describe(`Changed data not used by either page or static queries`, () => {
    let nodeChangeCounter = 1
    beforeEach(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createSiteNode, createTestNode, createNotUsedNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo`,
            content: `Lorem ipsum.`,
          })
          createTestNode({
            id: `test-2`,
            slug: `bar`,
            content: `Dolor sit amet.`,
          })
          createSiteNode({
            id: `Site`,
            siteMetadata: {
              title: `My Site`,
              description: `Description of site`,
            },
          })
          createNotUsedNode({
            id: `not-used`,
            content: `Content

            --edited
            edited content #${nodeChangeCounter++}`,
          })
        },
      })
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
          clearCache: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual(indexBarFooArray)
      expect(staticQueriesThatRan).toEqual([`static-query-1`])
    }, 99999)

    it(`changing node not used by anything doesn't trigger running any queries (no restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // クエリは 1 つも実行されないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)

    it(`changing node not used by anything doesn't trigger running any queries (with restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual(indexBarFooArray)

      // クエリは 1 つも実行されないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)
  })

  describe(`Changed node previously not used to be used by the query`, () => {
    let nodeChangeCounter = 1
    beforeEach(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createTestNode } = getTypedNodeCreators(nodeApiContext)

          for (let i = 1; i <= nodeChangeCounter; i++) {
            createTestNode({
              id: `test-${i}`,
              slug: `foo${i}`,
              content: `Lorem ipsum.`,
            })
          }

          nodeChangeCounter++
        },
      })
      setPageQueries({})
      setStaticQueries({
        "static-query-1": `
          {
            test(slug: { eq: "foo2" }) {
              slug
              content
            }
          }
        `,
        "static-query-2": `
          {
            test(slug: { eq: "foo3" }) {
              slug
              content
            }
          }
        `,
      })
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { staticQueriesThatRan } = await setup({
        restart: true,
        clearCache: true,
      })

      // すべてのクエリが実行される
      expect(staticQueriesThatRan).toEqual([`static-query-1`, `static-query-2`])
    }, 99999)

    it(`changing node to be used by any query triggers running that query (no restart)`, async () => {
      const { staticQueriesThatRan } = await setup()

      // フィルター `slug: { eq: "foo1" }` を指定してクエリを実行する
      expect(staticQueriesThatRan).toEqual([`static-query-1`, `static-query-2`])
    }, 999999)

    it(`changing node to be used by any query triggers running that query (with restart)`, async () => {
      const { staticQueriesThatRan } = await setup({ restart: true })

      // フィルター `slug: { eq: "foo2" }` を指定してクエリを実行する
      expect(staticQueriesThatRan).toEqual([`static-query-2`])
    }, 999999)
  })

  describe(`Changing data used in multiple queries properly invalidates them`, () => {
    let nodeChangeCounter = 1
    beforeAll(() => {
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createTestNode, createTestBNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo`,
            content: `Lorem ipsum.

            --edited
            edited content #${nodeChangeCounter++}`,
          })

          // このノードは変更されない
          createTestBNode({
            id: `test-b`,
            slug: `foo`,
            content: `Lorem ipsum.`,
          })
        },
        createPages: () => {},
      })
      setPageQueries({})
      setStaticQueries({
        "all-test-query-1": `
          {
            allTest {
              nodes {
                slug
              }
            }
          }
        `,
        "all-test-query-2": `
          {
            allTest {
              nodes {
                content
              }
            }
          }
        `,
        "all-test-b-query-1": `
          {
            allTestB {
              nodes {
                slug
              }
            }
          }
        `,
        "all-test-b-query-2": `
          {
            allTestB {
              nodes {
                content
              }
            }
          }
        `,
        "single-test-1": `
          {
            test(slug: { eq: "foo"}) {
              slug
            }
          }
        `,
        "single-test-2": `
          {
            test(slug: { eq: "foo"}) {
              content
            }
          }
        `,
        "single-test-b-1": `
          {
            testB(slug: { eq: "foo"}) {
              slug
            }
          }
        `,
        "single-test-b-2": `
          {
            testB(slug: { eq: "foo"}) {
              content
            }
          }
        `,
      })
    })

    it(`should run all queries after clearing cache`, async () => {
      const { staticQueriesThatRan } = await setup({
        restart: true,
        clearCache: true,
      })

      // 初回はすべてのクエリが実行されてほしい
      expect(staticQueriesThatRan).toEqual([
        `all-test-b-query-1`,
        `all-test-b-query-2`,
        `all-test-query-1`,
        `all-test-query-2`,
        `single-test-1`,
        `single-test-2`,
        `single-test-b-1`,
        `single-test-b-2`,
      ])
    }, 99999)

    it(`should run only queries that use changed data (no restart)`, async () => {
      const { staticQueriesThatRan } = await setup()

      expect(staticQueriesThatRan).toEqual([
        `all-test-query-1`,
        `all-test-query-2`,
        `single-test-1`,
        `single-test-2`,
      ])
    }, 99999)

    it(`should run only queries that use changed data (with restart)`, async () => {
      const { staticQueriesThatRan } = await setup({
        restart: true,
      })

      expect(staticQueriesThatRan).toEqual([
        `all-test-query-1`,
        `all-test-query-2`,
        `single-test-1`,
        `single-test-2`,
      ])
    }, 99999)
  })

  describe(`Changing page context invalidates page queries`, () => {
    beforeAll(() => {
      let pageChangeCounter = 1
      let nodeChangeCounter = 1
      setAPIhooks({
        sourceNodes: (nodeApiContext, _pluginOptions) => {
          const { createTestNode, createSiteNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `foo1`,
            content: `Lorem ipsum.`,
          })
          createTestNode({
            id: `test-2`,
            slug: `foo2`,
            content: `Dolor sit amet.`,
          })
          createTestNode({
            id: `test-3`,
            slug: `foo3`,
            content: `Consectetur adipiscing elit.`,
          })

          // これは、再起動せずに createPages を起動するためだけのもの
          createSiteNode({
            id: `Site`,
            siteMetadata: {
              title: `My Site`,
              description: `Description of site

              --edited
              edited content #${nodeChangeCounter++}
              `,
            },
          })
        },
        createPages: ({ actions: { createPage } }, _pluginOptions) => {
          createPage({
            component: `/src/templates/details.js`,
            path: `/`,
            context: {
              slug: `foo-${pageChangeCounter}`,
            },
          })

          pageChangeCounter++
        },
      })
      setPageQueries({
        "/src/templates/details.js": `
          query($slug: String!) {
            test(slug: { eq: $slug}) {
              slug
              content
            }
          }
        `,
      })
      setStaticQueries({})
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
        restart: true,
        clearCache: true,
      })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/`])

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
    }, 99999)

    it(`changing page context should rerun query (no restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, pages } = await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/`])

      // コンテキストが変わったページのクエリは再実行されるはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
    }, 999999)

    it(`changing page context should rerun query (with restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
        restart: true,
      })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/`])

      // コンテキストが変わったページのクエリは再実行されるはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
    }, 999999)
  })

  /*
    古い依存が時間とともに溜まっていかないように、クエリを（再）実行するときには
    データ依存を消去する必要がある。古い依存が残っていても、ビルドの成果物に問題は
    起きないが、状況によっては不要なクエリの実行が
    発生する
   */
  describe(`Clears data dependencies when query result is dirty`, () => {
    let stage
    beforeAll(() => {
      setAPIhooks({
        sourceNodes: ({ actions: { createNode }, createContentDigest }) => {
          const dirtyNodeCreator = typedNodeCreator(`DirtyTest`, {
            createNode,
            createContentDigest,
          })

          dirtyNodeCreator({
            id: `dirty`,
            link___NODE: stage === `initial` ? `linked-dirty` : undefined,
          })

          dirtyNodeCreator({
            id: `linked-dirty`,
            stage,
          })

          // このノードはクエリされない。スキーマに `link` フィールドが含まれるようにするためだけのもの
          dirtyNodeCreator({
            id: `mock`,
            link___NODE: `mock`,
          })
        },
        createPages: ({ actions: { createPage } }, _pluginOptions) => {
          createPage({
            component: `/src/templates/details.js`,
            path: `/`,
          })
        },
      })
      setPageQueries({
        "/src/templates/details.js": `
          {
            dirtyTest(id: {eq: "dirty"}) {
              id
              stage
              link {
                id
                stage
              }
            }
          }
        `,
      })
      setStaticQueries({
        "dirty-test": `
          {
            dirtyTest(id: {eq: "dirty"}) {
              id
              stage
              link {
                id
                stage
              }
            }
          }
        `,
      })
    })

    const runDataDependencyClearingOnDirtyTest = ({ withRestarts }) => {
      it(`Initial - adds linked node dependency`, async () => {
        stage = `initial`
        const { staticQueriesThatRan, pathsOfPagesWithQueriesThatRan, pages } =
          await setup({
            restart: true,
            clearCache: true,
          })
        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // 初回はすべてのクエリが実行されてほしい
        expect(staticQueriesThatRan).toEqual([`dirty-test`])
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
      }, 999999)

      it(`Removes linked data - query should be dirty`, async () => {
        stage = `remove-link`
        const { staticQueriesThatRan, pathsOfPagesWithQueriesThatRan, pages } =
          await setup({ restart: withRestarts })

        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // 直接クエリしているノードを変更した（link フィールドを削除した）ので、
        // すべてのクエリを再実行するはずである
        expect(staticQueriesThatRan).toEqual([`dirty-test`])
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
      }, 999999)

      it(`No change since last run, should not rerun any queries`, async () => {
        stage = `unchanged`
        const { staticQueriesThatRan, pathsOfPagesWithQueriesThatRan, pages } =
          await setup({ restart: withRestarts })

        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // リンク先のノードを変更したが、前回のクエリ実行ではそれを使っていなかったので、
        // クエリは 1 つも再実行しないはずである
        expect(staticQueriesThatRan).toEqual([])
        expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      }, 999999)
    }

    describe(`No restarts`, () => {
      runDataDependencyClearingOnDirtyTest({ withRestarts: false })
    })

    describe(`With restarts`, () => {
      runDataDependencyClearingOnDirtyTest({ withRestarts: true })
    })
  })

  describe(`Properly track connection when querying node interfaces`, () => {
    let stage
    beforeAll(() => {
      setAPIhooks({
        sourceNodes: ({ actions: { createNode }, createContentDigest }) => {
          const typeACreator = typedNodeCreator(`TypeA`, {
            createNode,
            createContentDigest,
          })

          const typeBCreator = typedNodeCreator(`TypeB`, {
            createNode,
            createContentDigest,
          })

          const typeUnrelatedCreator = typedNodeCreator(`TypeUnrelated`, {
            createNode,
            createContentDigest,
          })

          // すべての段階で:
          typeACreator({
            id: `type-A-1`,
            test: `Node A1`,
          })

          // 初回以外のすべての段階で
          if (stage !== `initial`) {
            typeACreator({
              id: `type-A-2`,
              test: `Node A2`,
            })
          }

          if (stage === `add-type-b` || stage === `add-unrelated-node`) {
            typeBCreator({
              id: `type-B-1`,
              test: `Node B1`,
            })
          }

          if (stage === `add-unrelated-node`) {
            typeUnrelatedCreator({
              id: `type-Unrelated-1`,
              test: `Node Unrelated1`,
            })
          }
        },
        createPages: ({ actions: { createPage } }, _pluginOptions) => {
          createPage({
            component: `/src/templates/details.js`,
            path: `/`,
          })
        },
        createSchemaCustomization: ({ actions: { createTypes } }) => {
          createTypes(`
            interface NodeInterface implements Node {
              id: ID!
              test: String
            }

            type TypeA implements Node & NodeInterface {
              id: ID!
              test: String
            }

            type TypeB implements Node & NodeInterface {
              id: ID!
              test: String
            }
          `)
        },
      })
      setPageQueries({
        "/src/templates/details.js": `
          {
            allNodeInterface {
              nodes {
                id
                test
              }
            }
          }
        `,
      })
      setStaticQueries({})
    })

    const runNodeInterfaceConnectionTrackingTest = ({ withRestarts }) => {
      it(`Initial - adds linked node dependency`, async () => {
        stage = `initial`
        const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
          restart: true,
          clearCache: true,
        })
        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // 初回はクエリが実行されてほしい
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
      }, 999999)

      it(`Adds another node of type that was already used - query should be dirty`, async () => {
        stage = `add-another-type-a`
        const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
          restart: withRestarts,
        })

        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // クエリしているノードインターフェースを実装する型のノードを追加したので、
        // クエリを再実行するはずである

        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
      }, 999999)

      it(`Adds node of the other type implementing same node interface - query should be dirty`, async () => {
        stage = `add-type-b`
        const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
          restart: withRestarts,
        })

        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // クエリしているノードインターフェースを実装する型のノードを追加したので、
        // クエリを再実行するはずである
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/`])
      }, 999999)

      it(`Adds node of type NOT implementing same node interface - query should NOT be dirty`, async () => {
        stage = `add-unrelated-node`
        const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
          restart: withRestarts,
        })

        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/`])

        // クエリしているノードインターフェースを実装する型のノードを追加したので、
        // クエリを再実行するはずである
        expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      }, 999999)
    }

    describe(`No restarts`, () => {
      runNodeInterfaceConnectionTrackingTest({ withRestarts: false })
    })

    describe(`With restarts`, () => {
      runNodeInterfaceConnectionTrackingTest({ withRestarts: true })
    })
  })

  // これは最後のテストにすること。クエリを持たないページを追加する（そのため依存は何も作られない）
  describe(`Running "queries" for page without query`, () => {
    beforeAll(() => {
      setAPIhooks({
        createPages: ({ actions: { createPage } }, _pluginOptions) => {
          createPage({
            component: `/src/templates/no-dep-page.js`,
            path: `/no-dep-page`,
            context: {},
          })
        },
      })
      setPageQueries({})
      setStaticQueries({})
    })

    it(`rerunning after cache clearing - should run all queries`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
          clearCache: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/no-dep-page/`])

      // 初回はすべてのクエリが実行されてほしい
      expect(pathsOfPagesWithQueriesThatRan).toEqual([`/no-dep-page/`])
      expect(staticQueriesThatRan).toEqual([])
    }, 99999)

    it(`rerunning should not run any queries (no restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup()

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/no-dep-page/`])

      // クエリは 1 つも実行されないはずである
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)

    it(`rerunning should not run any queries (with restart)`, async () => {
      const { pathsOfPagesWithQueriesThatRan, staticQueriesThatRan, pages } =
        await setup({
          restart: true,
        })

      // テストのセットアップが正しいことを念のため確認する
      expect(pages).toEqual([`/no-dep-page/`])

      // クエリは 1 つも実行されないはずである
      // 現状では、実際には `/no-dep-page` のクエリが再実行される
      expect(pathsOfPagesWithQueriesThatRan).toEqual([])
      expect(staticQueriesThatRan).toEqual([])
    }, 999999)
  })

  describe(`Properly tracks runQuery results (from custom resolvers)`, () => {
    let stage
    beforeAll(() => {
      setAPIhooks({
        createSchemaCustomization: ({ actions: { createTypes }, schema }) => {
          // 独自のリゾルバーを持つフィールドを先に定義する
          const resolveOne = type => (value, args, context) =>
            context.nodeModel.findOne({
              query: { testId: { eq: value.id } },
              type,
            })

          createTypes([
            schema.buildObjectType({
              name: `Foo`,
              fields: { id: `ID!` },
              interfaces: [`Node`],
            }),
            schema.buildObjectType({
              name: `Bar`,
              fields: { id: `ID!` },
              interfaces: [`Node`],
            }),
            schema.buildObjectType({
              name: `Test`,
              fields: {
                foo: {
                  type: `Foo`,
                  resolve: resolveOne(`Foo`),
                },
                bar: {
                  type: `Bar`,
                  resolve: resolveOne(`Bar`),
                },
                fooList: {
                  type: [`Foo`],
                  resolve: async (value, args, context) => {
                    const { entries } = await context.nodeModel.findAll({
                      query: { testId: { eq: value.id } },
                      type: `Foo`,
                    })
                    return entries
                  },
                },
                barList: {
                  type: [`Bar`],
                  resolve: async (value, args, context) => {
                    const { entries } = await context.nodeModel.findAll({
                      type: `Bar`,
                    })
                    return entries
                  },
                },
              },
              interfaces: [`Node`],
            }),
          ])
        },
        sourceNodes: nodeApiContext => {
          const { createTestNode, createFooNode, createBarNode } =
            getTypedNodeCreators(nodeApiContext)

          createTestNode({
            id: `test-1`,
            slug: `test`,
            content: `Lorem ipsum.`,
          })

          // 注: 最初は `Foo` ノードが 1 つもない
          createBarNode({
            id: `bar-1`,
            testId: `test-1`,
          })

          if (stage === `add-foo`) {
            createFooNode({
              id: `foo-1`,
              testId: `test-1`,
            })
          }
          if (stage === `delete-foo`) {
            const node = { id: `foo-1` }
            nodeApiContext.actions.deleteNode(node)
          }
          if (stage === `add-bar2`) {
            createBarNode({
              id: `bar-2`,
              testId: `test-1`,
            })
          }
          if (stage === `delete-bar2`) {
            const node = { id: `bar-2` }
            nodeApiContext.actions.deleteNode(node)
          }
          if (stage === `delete-bar1`) {
            const node = { id: `bar-1` }
            nodeApiContext.actions.deleteNode(node)
          }
        },
        createPages: ({ actions: { createPage } }, _pluginOptions) => {
          createPage({
            component: `/src/templates/foo.js`,
            path: `/foo`,
          })
          createPage({
            component: `/src/templates/foo-list.js`,
            path: `/foo-list`,
          })
          createPage({
            component: `/src/templates/bar.js`,
            path: `/bar`,
          })
          createPage({
            component: `/src/templates/bar-list.js`,
            path: `/bar-list`,
          })
        },
      })
      setPageQueries({
        "/src/templates/foo.js": `
          {
            test {
              foo { id }
            }
          }
        `,
        "/src/templates/foo-list.js": `
          {
            test {
              fooList { id }
            }
          }
        `,
        "/src/templates/bar.js": `
          {
            test {
              bar { id }
            }
          }
        `,
        "/src/templates/bar-list.js": `
          {
            test {
              barList { id }
            }
          }
        `,
      })
      setStaticQueries({})
    })

    const runDataDependencyClearingOnDirtyTest = ({ withRestarts }) => {
      it(`Initial - runs all queries`, async () => {
        stage = `initial`
        const { pathsOfPagesWithQueriesThatRan, pages } = await setup({
          restart: true,
          clearCache: true,
        })
        // テストのセットアップが正しいことを念のため確認する
        expect(pages).toEqual([`/bar-list/`, `/bar/`, `/foo-list/`, `/foo/`])

        // 初回はクエリが実行されてほしい
        expect(pathsOfPagesWithQueriesThatRan).toEqual([
          `/bar-list/`,
          `/bar/`,
          `/foo-list/`,
          `/foo/`,
        ])
      }, 999999)

      it(`re-runs queries when a foo node is added`, async () => {
        stage = `add-foo`
        const { pathsOfPagesWithQueriesThatRan } = await setup({
          restart: withRestarts,
        })

        // これまで "foo" ノードが 1 つもなかったので、"/foo" も再実行する
        // （新しいノードがこのクエリに一致するようになったかもしれないため）
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/foo-list/`, `/foo/`])
      }, 999999)

      it(`re-runs queries when a foo node is deleted`, async () => {
        stage = `delete-foo`
        const { pathsOfPagesWithQueriesThatRan } = await setup({
          restart: withRestarts,
        })

        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/foo-list/`, `/foo/`])
      }, 999999)

      it(`re-runs queries when a bar-2 node is added`, async () => {
        stage = `add-bar2`
        const { pathsOfPagesWithQueriesThatRan } = await setup({
          restart: withRestarts,
        })

        // 注: "/bar" のクエリは再実行しない。追跡している関係が "node: bar-1" だからである。
        // ノード "bar-2" を追加しても、この関係には影響しない。
        // FIXME: "id" 以外のフィールドでフィルターする場合、これは実際には誤った動作になりうる
        //   追跡に connection とフィルターを使うように作り直すべきである。
        //   そうすると、このテストでも "/bar" のクエリが再実行されるようになる（bar に関係する他のテストにも影響する）
        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/bar-list/`])
      }, 999999)

      it(`re-runs queries when a bar-2 node is deleted`, async () => {
        stage = `delete-bar2`
        const { pathsOfPagesWithQueriesThatRan } = await setup({
          restart: withRestarts,
        })

        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/bar-list/`])
      }, 999999)

      it(`re-runs queries when a bar-1 node is deleted`, async () => {
        stage = `delete-bar1`
        const { pathsOfPagesWithQueriesThatRan } = await setup({
          restart: withRestarts,
        })

        expect(pathsOfPagesWithQueriesThatRan).toEqual([`/bar-list/`, `/bar/`])
      }, 999999)
    }

    describe(`No restarts`, () => {
      runDataDependencyClearingOnDirtyTest({ withRestarts: false })
    })

    describe(`With restarts`, () => {
      runDataDependencyClearingOnDirtyTest({ withRestarts: true })
    })
  })
})
