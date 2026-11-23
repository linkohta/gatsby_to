const _ = require(`lodash`)
const path = require(`path`)
const v8 = require(`v8`)
const reporter = require(`gatsby-cli/lib/reporter`)
const writeToCache = jest.spyOn(require(`../persist`), `writeToCache`)
const v8Serialize = jest.spyOn(v8, `serialize`)
const v8Deserialize = jest.spyOn(v8, `deserialize`)
const reporterInfo = jest.spyOn(reporter, `info`).mockImplementation(jest.fn)
const reporterWarn = jest.spyOn(reporter, `warn`).mockImplementation(jest.fn)

const { saveState, store, readState, savePartialStateToDisk } = require(
  `../index`
)

const {
  actions: { createPage, createNode },
} = require(`../actions`)

const pageTemplatePath = `/Users/username/dev/site/src/templates/my-sweet-new-page.js`
const mockWrittenContent = new Map()
const mockCompatiblePath = path
jest.mock(`fs-extra`, () => {
  return {
    writeFileSync: jest.fn((file, content) =>
      mockWrittenContent.set(file, content)
    ),
    outputFileSync: jest.fn((file, content) =>
      mockWrittenContent.set(file, content)
    ),
    readFileSync: jest.fn(file => mockWrittenContent.get(file)),
    moveSync: jest.fn((from, to) => {
      // フォルダーについては、それが常にファイルの完全なプレフィックスである場合にしか
      // 動かない...（これは両方の入力ディレクトリに当てはまる）。ここではその条件を満たしている。
      if (mockWrittenContent.has(to)) {
        throw new Error(`File/folder exists`)
      }

      // このフォルダーの中のファイルもすべて移動する ... :/
      mockWrittenContent.forEach((value, key) => {
        if (key.startsWith(from)) {
          // rename('foo/bar', 'a/b/c') => foo/bar/ding.js -> a/b/c/ding.js
          // （文字列を引数にした .replace は、最初に現れたものしか置き換えない）
          mockWrittenContent.set(
            key.replace(from, to),
            mockWrittenContent.get(key)
          )
          mockWrittenContent.delete(key)
        }
      })
    }),
    existsSync: jest.fn(target => mockWrittenContent.has(target)),
    mkdtempSync: jest.fn(suffix => {
      const dir = mockCompatiblePath.join(
        `some`,
        `tmp` + suffix + Math.random()
      )
      mockWrittenContent.set(dir, Buffer(`empty dir`))
      return dir
    }),
    removeSync: jest.fn(file => mockWrittenContent.delete(file)),
  }
})
jest.mock(`glob`, () => {
  return {
    globSync: jest.fn(pattern => {
      // ややこしい。
      // スターで終わるパスのプレフィックスを期待している。そうでないと動かない :/
      if (pattern.slice(-1) !== `*`) {
        throw new Error(`Expected pattern ending with star`)
      }
      const globPrefix = pattern.slice(0, -1)
      if (globPrefix.includes(`*`)) {
        throw new Error(`Expected pattern to be a prefix`)
      }
      const files = []
      mockWrittenContent.forEach((value, key) => {
        if (key.startsWith(globPrefix)) {
          files.push(key)
        }
      })
      return files
    }),
  }
})

jest.mock(`gatsby-core-utils`, () => {
  return {
    ...jest.requireActual(`gatsby-core-utils`),
    murmurhash: {
      murmurhash: jest.fn(() => `1234567890`),
    },
    uuid: {
      v4: jest.fn(() => `1234567890`),
    },
  }
})

function getFakeNodes() {
  // nodes に何かを設定する。キャッシュがこれをアサートしているので、設定しないと失敗する
  // 実際の nodes の内容は TS の型と一致していなければならない。これらは検証される
  const map /* : Map<string, IReduxNode> */ = new Map()
  map.set(`pageA`, {
    id: `pageA`,
    internal: {
      type: `Ding`,
    },
  })
  map.set(`pageB`, {
    id: `pageB`,
    internal: {
      type: `Dong`,
    },
  })
  return map
}

describe(`redux db`, () => {
  const initialComponentsState = _.cloneDeep(store.getState().components)

  function createPages(pages) {
    // テストの間で Date.now() が変わらないように、Date.now をモックする
    const RealDateNow = Date.now
    let DateNowCallCount = 0
    // （実際の時刻の値ではなく）呼び出し回数のカウンターを増やすことで、時間の経過をシミュレートする
    Date.now = jest.fn(() => ++DateNowCallCount)

    store.dispatch(
      (Array.isArray(pages) ? pages : [pages]).map(
        page =>
          createPage(page, {
            name: `default-site-plugin`,
          }).filter(a => a.type === `CREATE_PAGE`)[0]
      )
    )

    Date.now = RealDateNow
  }

  const defaultPage = {
    path: `/my-sweet-new-page/`,
    // Windows では、jest のシリアライザーが Map をうまく扱えないようだ
    component: pageTemplatePath,
    // コンテキストは、props としてコンポーネントに渡されるほか、
    // コンポーネントの GraphQL クエリにも渡される。
    context: {
      id: `123456`,
    },
  }

  beforeEach(() => {
    store.getState().nodes = new Map()
    store.dispatch({
      type: `DELETE_CACHE`,
    })
    writeToCache.mockClear()
    mockWrittenContent.clear()
    mockWrittenContent.set(pageTemplatePath, `foo`)
    reporterWarn.mockClear()
    reporterInfo.mockClear()
  })

  it(`should write redux cache to disk`, async () => {
    createPages(defaultPage)

    expect(initialComponentsState).toEqual(new Map())

    store.getState().nodes = getFakeNodes()

    await saveState()

    expect(writeToCache).toHaveBeenCalled()

    // メモリー上の状態をリセットする
    store.dispatch({
      type: `DELETE_CACHE`,
    })
    // メモリー上のストアが空であることを確認する
    expect(store.getState().components).toEqual(initialComponentsState)

    // 以前にキャッシュされたデータを読み込む
    const data = readState()

    // データが読み込まれ、クリーンな redux の状態とは異なることを確認する
    expect(data.components).not.toEqual(initialComponentsState)

    expect(data).toMatchSnapshot()
  })

  describe(`GATSBY_DISABLE_CACHE_PERSISTENCE`, () => {
    beforeAll(() => {
      process.env.GATSBY_DISABLE_CACHE_PERSISTENCE = `truthy`
    })

    afterAll(() => {
      delete process.env.GATSBY_DISABLE_CACHE_PERSISTENCE
    })
    it(`shouldn't write redux cache to disk when GATSBY_DISABLE_CACHE_PERSISTENCE env var is used`, async () => {
      expect(initialComponentsState).toEqual(new Map())

      store.getState().nodes = getFakeNodes()

      await saveState()

      expect(writeToCache).not.toHaveBeenCalled()
    })
  })

  describe(`Sharding`, () => {
    afterAll(() => {
      v8Serialize.mockRestore()
      v8Deserialize.mockRestore()
    })

    // 上限はシャード 1 つあたり 1.5 * 1024 * 1024 * 1024 に設定している
    // ページのサイズをシミュレートすることで、期待した数のシャードが作られることと、
    // それらを正しくつなぎ合わせて元に戻せることを確認できる
    const pageShardsScenarios = [
      {
        numberOfPages: 50 * 1000,
        simulatedPageObjectSize: 10 * 1024,
        expectedNumberOfPageShards: 1,
        expectedPageContextSizeWarning: false,
      },
      {
        numberOfPages: 50,
        simulatedPageObjectSize: 10 * 1024 * 1024,
        expectedNumberOfPageShards: 1,
        expectedPageContextSizeWarning: true,
      },
      {
        numberOfPages: 5,
        simulatedPageObjectSize: 0.9 * 1024 * 1024 * 1024,
        expectedNumberOfPageShards: 5,
        expectedPageContextSizeWarning: true,
      },
    ]

    const scenarios = []
    for (const pageShardsParams of pageShardsScenarios) {
      scenarios.push([
        pageShardsParams.numberOfPages,
        pageShardsParams.simulatedPageObjectSize,
        pageShardsParams.expectedNumberOfPageShards,
        pageShardsParams.expectedPageContextSizeWarning
          ? `with page context size warning`
          : `without page context size warning`,
        pageShardsParams.expectedPageContextSizeWarning,
      ])
    }

    it.each(scenarios)(
      `Scenario Pages %i x %i bytes = %i shards (%s)`,
      async (
        numberOfPages,
        simulatedPageObjectSize,
        expectedNumberOfPageShards,
        _expectedPageContextSizeWarningLabelForTestName,
        expectedPageContextSizeWarning
      ) => {
        // テストのセットアップが正しいことを確かめるための基本的な確認。メモリー上の状態と永続化された状態の両方を確認し、
        // 空であることを確かめる
        const initialStateInMemory = store.getState()
        expect(initialStateInMemory.pages).toEqual(new Map())

        // 永続化された状態はまだないはずである。これは空のオブジェクトを返し、
        // redux がすべてのスライスで初期状態を使うようにする
        const initialPersistedState = readState()
        expect(initialPersistedState.pages).toBeUndefined()
        expect(initialPersistedState).toEqual({})

        createPages(
          new Array(numberOfPages).fill(undefined).map((_, index) => {
            return {
              path: `/page-${index}/`,
              component: `/Users/username/dev/site/src/templates/my-sweet-new-page.js`,
              context: {
                objectType: `page`,
                possiblyHugeField: `let's pretend this field is huge (we will simulate that by mocking some things used to asses size of object)`,
              },
            }
          })
        )

        const currentStateInMemory = store.getState()
        expect(currentStateInMemory.pages.size).toEqual(numberOfPages)

        // これは、readState の実装が変わってもこのテストに影響しないように
        // するためのものである。現在の状態を複製しておき、それを
        // アサーションに使う
        const clonedCurrentPages = new Map(currentStateInMemory.pages)

        // 永続化された状態はまだなく、現在のメモリー上の状態がそれに影響しないはずである
        const persistedStateBeforeSaving = readState()
        expect(persistedStateBeforeSaving.pages).toBeUndefined()
        expect(persistedStateBeforeSaving).toEqual({})

        // ページが、シナリオのパラメーターで指定されたサイズを持っているようにシミュレートする
        // 実装を JSON.stringify に変えている。v8.serialize をもう一度呼ぶと
        // スタックサイズの上限エラーになるためである :shrug:。これに合わせて
        // deserialize の実装も調整する必要がある
        v8Serialize.mockImplementation(obj => {
          if (obj?.[1]?.context?.objectType === `page`) {
            return {
              toString: () => JSON.stringify(obj),
              length: simulatedPageObjectSize,
            }
          } else {
            return JSON.stringify(obj)
          }
        })
        v8Deserialize.mockImplementation(obj => JSON.parse(obj.toString()))

        await saveState()

        if (expectedPageContextSizeWarning) {
          expect(reporterWarn).toHaveBeenCalledWith(
            `The size of at least one page context chunk exceeded 500kb, which could lead to degraded performance. Consider putting less data in the page context.`
          )
        } else {
          expect(reporterWarn).not.toHaveBeenCalled()
        }

        const shardsWritten = {
          rest: 0,
          page: 0,
        }

        for (const fileWritten of mockWrittenContent.keys()) {
          const basename = path.basename(fileWritten)
          if (basename.startsWith(`redux.rest`)) {
            shardsWritten.rest++
          } else if (basename.startsWith(`redux.page`)) {
            shardsWritten.page++
          }
        }

        expect(writeToCache).toHaveBeenCalled()

        expect(shardsWritten.rest).toEqual(1)
        expect(shardsWritten.page).toEqual(expectedNumberOfPageShards)

        // 最後に、シャードを読み込むと正しくつなぎ合わされて元に戻ることを
        // 確認する
        const persistedStateAfterSaving = readState()

        expect(persistedStateAfterSaving.pages).toEqual(clonedCurrentPages)
      }
    )
  })

  it(`doesn't discard persisted cache if no pages`, () => {
    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    store.dispatch(
      createNode(
        {
          id: `node-test`,
          context: {
            objectType: `node`,
          },
          internal: {
            type: `Foo`,
            contentDigest: `contentDigest-test`,
          },
        },
        { name: `gatsby-source-test` }
      )
    )

    // strict モードでは、ノードは redux の状態ではなく LMDB に保存される
    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    let persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(0)
    expect(persistedState.pages?.size ?? 0).toEqual(0)

    saveState()

    // メモリー上の状態をリセットする
    store.dispatch({
      type: `DELETE_CACHE`,
    })

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    persistedState = readState()

    // lmdb ストアでは、"Cache exists but contains no nodes..." の警告を回避するために、
    // 常にダミーのノードを 1 つ永続化する
    expect(persistedState.nodes?.size).toEqual(1)
    const nodes = Array.from(persistedState.nodes.values())
    expect(nodes[0]).toMatchObject({ id: `dummy-node-id` })

    expect(persistedState.pages?.size ?? 0).toEqual(0)
  })

  it(`discards persisted cache if no nodes are stored there`, () => {
    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    createPages(defaultPage)

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(1)

    let persistedState = readState()

    expect(persistedState.nodes?.size ?? 0).toEqual(0)
    expect(persistedState.pages?.size ?? 0).toEqual(0)

    saveState()

    // メモリー上の状態をリセットする
    store.dispatch({
      type: `DELETE_CACHE`,
    })

    expect(store.getState().nodes.size).toEqual(0)
    expect(store.getState().pages.size).toEqual(0)

    persistedState = readState()

    // lmdb ストアでは、"Cache exists but contains no nodes..." の警告を回避するために、
    // 常にダミーのノードを 1 つ永続化する
    expect(persistedState.nodes?.size ?? 0).toEqual(1)
    expect(persistedState.pages?.size ?? 0).toEqual(1)
    expect(reporterInfo).not.toHaveBeenCalled()
    const nodes = Array.from(persistedState.nodes.values())
    expect(nodes[0]).toMatchObject({ id: `dummy-node-id` })
  })

  describe(`savePartialStateToDisk`, () => {
    beforeEach(() => {
      createPages(defaultPage)
    })

    it(`saves with correct filename (with defaults)`, () => {
      savePartialStateToDisk([`pages`])

      let basename
      // ページテンプレート以外で最初の、モックされた fs の書き込みを取得する
      for (const savedFile of mockWrittenContent.keys()) {
        if (savedFile === pageTemplatePath) {
          continue
        }

        basename = path.basename(savedFile)
        break
      }

      expect(basename.startsWith(`redux.worker.slices__`)).toBe(true)
    })

    it(`saves correct slice of state`, () => {
      savePartialStateToDisk([`pages`])

      expect(writeToCache).toHaveBeenCalledWith(
        { pages: expect.anything() },
        [`pages`],
        undefined
      )
    })

    it(`respects optionalPrefix`, () => {
      savePartialStateToDisk([`pages`], `custom-prefix`)

      let basename
      // ページテンプレート以外で最初の、モックされた fs の書き込みを取得する
      for (const savedFile of mockWrittenContent.keys()) {
        if (savedFile === pageTemplatePath) {
          continue
        }

        basename = path.basename(savedFile)
        break
      }

      expect(basename.startsWith(`redux.worker.slices_custom-prefix_`)).toBe(
        true
      )
    })

    it(`respects transformState`, () => {
      const customTransform = state => {
        return {
          ...state,
          hello: `world`,
        }
      }

      savePartialStateToDisk([`pages`], undefined, customTransform)

      expect(writeToCache).toHaveBeenCalledWith(
        { pages: expect.anything(), hello: `world` },
        [`pages`],
        undefined
      )
    })
  })
})
