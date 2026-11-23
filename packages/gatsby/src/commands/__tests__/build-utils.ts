import {
  IGatsbyState,
  IGatsbyPage,
  IHtmlFileState,
  IStaticQueryResultState,
} from "../../redux/types"

interface IMinimalStateSliceForTest {
  html: IGatsbyState[`html`]
  pages: IGatsbyState[`pages`]
  components: IGatsbyState[`components`]
}

describe(`calcDirtyHtmlFiles`, () => {
  let calcDirtyHtmlFiles
  beforeEach(() => {
    jest.isolateModules(() => {
      calcDirtyHtmlFiles = require(`../build-utils`).calcDirtyHtmlFiles
    })
  })

  function generateStateToTestHelper(
    pages: Record<
      string,
      {
        dirty: number
        removedOrDeleted?: `deleted` | `not-recreated`
      }
    >
  ): IGatsbyState {
    const state: IMinimalStateSliceForTest = {
      pages: new Map<string, IGatsbyPage>(),
      html: {
        browserCompilationHash: `a-hash`,
        ssrCompilationHash: `a-hash`,
        trackedHtmlFiles: new Map<string, IHtmlFileState>(),
        unsafeBuiltinWasUsedInSSR: false,
        trackedStaticQueryResults: new Map<string, IStaticQueryResultState>(),
      },
      components: new Map(),
    }
    state.components.set(`/foo`, {
      componentPath: `/foo`,
      componentChunkName: `foo`,
      pages: new Set(),
      isInBootstrap: false,
      query: ``,
      serverData: false,
    })

    for (const pagePath in pages) {
      const page = pages[pagePath]

      if (page.removedOrDeleted !== `not-recreated`) {
        state.pages.set(pagePath, {
          component: `/foo`,
          componentPath: `/foo`,
          componentChunkName: `foo`,
          context: {},
          internalComponentName: `foo`,
          isCreatedByStatefulCreatePages: false,
          path: pagePath,
          matchPath: undefined,
          pluginCreatorId: `foo`,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          pluginCreator___NODE: `foo`,
          updatedAt: 1,
          mode: `SSG`,
          defer: false,
          ownerNodeId: ``,
        })
      }

      state.html.trackedHtmlFiles.set(pagePath, {
        dirty: page.dirty,
        pageDataHash: `a-hash`,
        isDeleted: page.removedOrDeleted === `deleted`,
      })
    }

    return state as IGatsbyState
  }

  it(`nothing changed`, () => {
    const state = generateStateToTestHelper({
      // ページは dirty ではない。再利用できるので、再生成、削除、クリーンアップのいずれもすべきではない
      "/to-reuse/": {
        dirty: 0,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    // 何も変わっていないので、再生成、削除、クリーンアップのいずれもすべきではない
    expect(results.toRegenerate.sort()).toEqual([])
    expect(results.toDelete.sort()).toEqual([])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([])
  })

  it(`content for few pages changed`, () => {
    const state = generateStateToTestHelper({
      // ページが何らかの理由で dirty とマークされた
      "/to-regenerate/": {
        dirty: 42,
      },
      "/to-regenerate/nested/": {
        dirty: 42,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    // ページが dirty とマークされているので、その成果物は（再）生成されるべきである
    expect(results.toRegenerate.sort()).toEqual([
      `/to-regenerate/`,
      `/to-regenerate/nested/`,
    ])
    expect(results.toDelete.sort()).toEqual([])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([])
  })

  it(`few pages were deleted`, () => {
    const state = generateStateToTestHelper({
      // ページが `deletePage` アクションで削除された
      "/deleted/": {
        dirty: 0,
        removedOrDeleted: `deleted`,
      },
      "/deleted/nested/": {
        dirty: 42,
        removedOrDeleted: `deleted`,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    // ページが削除済みとマークされているので、その成果物は削除されるべきである
    expect(results.toRegenerate.sort()).toEqual([])
    expect(results.toDelete.sort()).toEqual([`/deleted/`, `/deleted/nested/`])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([])
  })

  it(`few pages were not re-created`, () => {
    const state = generateStateToTestHelper({
      // ページは追跡されているが、再作成されなかった
      "/not-recreated/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },
      "/not-recreated/nested/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    // ページが再作成されていないので、その成果物は削除されるべきである
    expect(results.toRegenerate.sort()).toEqual([])
    expect(results.toDelete.sort()).toEqual([
      `/not-recreated/`,
      `/not-recreated/nested/`,
    ])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([])
  })

  describe(`onCreatePage + deletePage + createPage that change path of a page (remove trailing slash)`, () => {
    it(`page is dirty`, () => {
      const state = generateStateToTestHelper({
        // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
        // どちらのページパスも同じ成果物になる
        "/remove-trailing-slashes-dirty/": {
          dirty: 0,
          removedOrDeleted: `deleted`,
        },
        "/remove-trailing-slashes-dirty": {
          dirty: 42,
        },
      })

      const results = calcDirtyHtmlFiles(state)

      // ページが同じファイル名の成果物を生成するので、削除されたページの成果物は
      // 削除されないことを期待する。代わりに、追跡している状態のクリーンアップと、
      // パスを調整した新しいページの再生成だけが行われる
      expect(results.toRegenerate.sort()).toEqual([
        `/remove-trailing-slashes-dirty`,
      ])
      expect(results.toDelete.sort()).toEqual([])
      expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([
        `/remove-trailing-slashes-dirty/`,
      ])
    })

    it(`page is NOT dirty`, () => {
      const state = generateStateToTestHelper({
        // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
        // どちらのページパスも同じ成果物になる
        "/remove-trailing-slashes-not-dirty/": {
          dirty: 0,
          removedOrDeleted: `deleted`,
        },
        "/remove-trailing-slashes-not-dirty": {
          dirty: 0,
        },
      })

      const results = calcDirtyHtmlFiles(state)

      // ページが同じファイル名の成果物を生成するので、削除されたページの成果物は
      // 削除されないことを期待する。代わりに、追跡している状態のクリーンアップだけが行われる
      // 調整後のページは dirty とマークされていないので、再生成されるべきではない ()
      expect(results.toRegenerate.sort()).toEqual([])
      expect(results.toDelete.sort()).toEqual([])
      expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([
        `/remove-trailing-slashes-not-dirty/`,
      ])
    })
  })

  it(`slash was removed between builds (without onCreatePage + deletePage combination)`, () => {
    const state = generateStateToTestHelper({
      // ページは前回のビルドで作成されたが、今回は再作成されなかった
      // 代わりに、パスが少しだけ異なるページが作成された
      // どちらのページパスも同じ成果物になる
      "/slash-removed-without-onCreatePage/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },
      "/slash-removed-without-onCreatePage": {
        dirty: 1,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    expect(results.toRegenerate.sort()).toEqual([
      `/slash-removed-without-onCreatePage`,
    ])
    expect(results.toDelete.sort()).toEqual([])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([
      `/slash-removed-without-onCreatePage/`,
    ])
  })

  describe(`onCreatePage + deletePage + createPage that change path casing of a page`, () => {
    it(`linux (case sensitive file system)`, () => {
      let isolatedCalcDirtyHtmlFiles
      jest.isolateModules(() => {
        process.env.TEST_FORCE_CASE_FS = `SENSITIVE`
        isolatedCalcDirtyHtmlFiles =
          require(`../build-utils`).calcDirtyHtmlFiles
        delete process.env.TEST_FORCE_CASE_FS
      })

      const state = generateStateToTestHelper({
        // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
        // それぞれ異なる成果物が作成される
        "/TEST/": {
          dirty: 0,
          removedOrDeleted: `deleted`,
        },
        "/test/": {
          dirty: 1,
        },
      })

      const results = isolatedCalcDirtyHtmlFiles(state)

      // 大文字と小文字を区別するファイルシステムでは /test/ と /TEST/ は別のファイルなので、ファイルを削除する必要がある
      expect(results.toRegenerate.sort()).toEqual([`/test/`])
      expect(results.toDelete.sort()).toEqual([`/TEST/`])
      expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([])
    })

    it(`windows / mac (case insensitive file system)`, () => {
      let isolatedCalcDirtyHtmlFiles
      jest.isolateModules(() => {
        process.env.TEST_FORCE_CASE_FS = `INSENSITIVE`
        isolatedCalcDirtyHtmlFiles =
          require(`../build-utils`).calcDirtyHtmlFiles
        delete process.env.TEST_FORCE_CASE_FS
      })

      const state = generateStateToTestHelper({
        // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
        // どちらのページパスも同じ成果物になる
        "/TEST/": {
          dirty: 0,
          removedOrDeleted: `deleted`,
        },
        "/test/": {
          dirty: 1,
        },
      })

      const results = isolatedCalcDirtyHtmlFiles(state)

      // 大文字と小文字を区別しないファイルシステムでは /test/ と /TEST/ は別のファイルではないので、
      // ファイルは削除すべきではない。ただし、追跡している状態はクリーンアップすべきである
      expect(results.toRegenerate.sort()).toEqual([`/test/`])
      expect(results.toDelete.sort()).toEqual([])
      expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([
        `/TEST/`,
      ])
    })
  })

  // 上のケースは、失敗の箇所を正確に特定できるようにするためのものである。全部入りのケースは、上記すべてを一度にテストし、
  // さまざまな条件が混在しても正しく処理されることを確認する
  it(`kitchen sink`, () => {
    const state = generateStateToTestHelper({
      // ページは dirty ではない。再利用できるので、再生成、削除、クリーンアップのいずれもすべきではない
      "/to-reuse/": {
        dirty: 0,
      },

      // ページが何らかの理由で dirty とマークされた
      "/to-regenerate/": {
        dirty: 42,
      },
      "/to-regenerate/nested/": {
        dirty: 42,
      },

      // ページが `deletePage` アクションで削除された
      "/deleted/": {
        dirty: 0,
        removedOrDeleted: `deleted`,
      },
      "/deleted/nested/": {
        dirty: 42,
        removedOrDeleted: `deleted`,
      },

      // ページは追跡されているが、再作成されなかった
      "/not-recreated/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },
      "/not-recreated/nested/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },

      // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
      // どちらのページパスも同じ成果物になる
      "/remove-trailing-slashes-dirty/": {
        dirty: 0,
        removedOrDeleted: `deleted`,
      },
      "/remove-trailing-slashes-dirty": {
        dirty: 42,
      },

      // ページが作成され、その後削除され、パスが少しだけ異なる似たページが代わりに作成された
      // どちらのページパスも同じ成果物になる
      "/remove-trailing-slashes-not-dirty/": {
        dirty: 0,
        removedOrDeleted: `deleted`,
      },
      "/remove-trailing-slashes-not-dirty": {
        dirty: 0,
      },

      // ページは前回のビルドで作成されたが、今回は再作成されなかった
      // 代わりに、パスが少しだけ異なるページが作成された
      // どちらのページパスも同じ成果物になる
      "/slash-removed-without-onCreatePage/": {
        dirty: 0,
        removedOrDeleted: `not-recreated`,
      },
      "/slash-removed-without-onCreatePage": {
        dirty: 1,
      },
    })

    const results = calcDirtyHtmlFiles(state)

    expect(results.toRegenerate.sort()).toEqual([
      `/remove-trailing-slashes-dirty`,
      `/slash-removed-without-onCreatePage`,
      `/to-regenerate/`,
      `/to-regenerate/nested/`,
    ])
    expect(results.toDelete.sort()).toEqual([
      `/deleted/`,
      `/deleted/nested/`,
      `/not-recreated/`,
      `/not-recreated/nested/`,
    ])
    expect(Array.from(results.toCleanupFromTrackedState).sort()).toEqual([
      `/remove-trailing-slashes-dirty/`,
      `/remove-trailing-slashes-not-dirty/`,
      `/slash-removed-without-onCreatePage/`,
    ])
  })
})
