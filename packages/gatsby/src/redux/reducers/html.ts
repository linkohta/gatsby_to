import {
  ActionsUnion,
  IGatsbyState,
  IHtmlFileState,
  IStaticQueryResultState,
} from "../types"

const FLAG_DIRTY_CLEARED_CACHE = 0b0000001
const FLAG_DIRTY_NEW_ENTRY = 0b0000010
const FLAG_DIRTY_DATA_CHANGED = 0b0000100
const FLAG_DIRTY_STATIC_QUERY_FIRST_RUN = 0b0001000
const FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED = 0b0010000
const FLAG_DIRTY_BROWSER_COMPILATION_HASH = 0b0100000
const FLAG_DIRTY_SSR_COMPILATION_HASH = 0b1000000

type PagePath = string

function initialState(): IGatsbyState[`html`] {
  return {
    trackedHtmlFiles: new Map<PagePath, IHtmlFileState>(),
    slicesProps: {
      bySliceId: new Map(),
      byPagePath: new Map(),
      bySliceName: new Map(),
    },
    browserCompilationHash: ``,
    ssrCompilationHash: ``,
    trackedStaticQueryResults: new Map<string, IStaticQueryResultState>(),
    unsafeBuiltinWasUsedInSSR: false,
    templateCompilationHashes: {},
    pagesThatNeedToStitchSlices: new Set(),
  }
}

export function htmlReducer(
  state: IGatsbyState[`html`] = initialState(),
  action: ActionsUnion
): IGatsbyState[`html`] {
  switch (action.type) {
    case `DELETE_CACHE`: {
      if (action.cacheIsCorrupt) {
        // `public` が存在しないので、まっさらな状態から始められる
        return initialState()
      } else {
        // ここで単純にキャッシュを消すことはできない。ページを追跡し続けたいので、すべてに "deleted" の印を付ける
        // ページが作り直されれば、"isDeleted" フラグは取り除かれる
        state.browserCompilationHash = ``
        state.ssrCompilationHash = ``
        state.templateCompilationHashes = {}
        state.trackedStaticQueryResults.clear()
        state.unsafeBuiltinWasUsedInSSR = false
        state.trackedHtmlFiles.forEach(htmlFile => {
          htmlFile.isDeleted = true
          // どこかに変更があったので、念のためそれらのファイルにもダーティの印を付ける
          htmlFile.dirty |= FLAG_DIRTY_CLEARED_CACHE
        })
        // スライスの html は削除する必要がなく、消去するだけでよい
        state.slicesProps = {
          bySliceId: new Map(),
          byPagePath: new Map(),
          bySliceName: new Map(),
        }
        state.pagesThatNeedToStitchSlices = new Set()
        return state
      }
    }

    case `CREATE_PAGE`: {
      // CREATE_PAGE はページがすでに存在していても呼ばれることがあるので、そのページをまだ
      // 追跡していない場合か、ページに削除済みの印が付いている場合にだけ処理をする
      const { path } = action.payload

      let htmlFile = state.trackedHtmlFiles.get(path)
      if (!htmlFile) {
        htmlFile = {
          dirty: FLAG_DIRTY_NEW_ENTRY,
          isDeleted: false,
          pageDataHash: ``,
        }
        state.trackedHtmlFiles.set(path, htmlFile)
      } else if (htmlFile.isDeleted) {
        // ページが作り直されたので、`isDeleted` フラグを取り除く
        // ダーティの状態を変える必要があるかは未定
        htmlFile.isDeleted = false
      }

      return state
    }

    case `CREATE_SLICE`: {
      const existing = state.slicesProps.bySliceName.get(action.payload.name)
      if (!existing) {
        state.slicesProps.bySliceName.set(action.payload.name, {
          dirty: FLAG_DIRTY_NEW_ENTRY,
          props: new Set(),
          sliceDataHash: ``,
        })
      }
      return state
    }

    case `DELETE_PAGE`: {
      const { path } = action.payload
      const htmlFile = state.trackedHtmlFiles.get(path)

      if (!htmlFile) {
        // 不変条件
        throw new Error(
          `[html reducer] how can I delete page that wasn't created (?)`
        )
      }

      htmlFile.isDeleted = true
      // ダーティの状態を変える必要があるかは未定
      return state
    }

    case `PAGE_QUERY_RUN`: {
      // アクション名に反して、このアクションは実際にはページクエリと静的クエリの両方で発行される。
      // ここで実際に関心があるのは、静的クエリの結果（特にそのハッシュ）だけである。
      // ページクエリの結果には関心がない。html を生成するときにページクエリの結果を直接は
      // 使わないためである。関心があるのは（ページクエリの結果を含む）page-data である。
      // page-data の処理は、間接的にページクエリの結果も扱うことになり、
      // `ADD_PAGE_DATA_STATS` アクションのハンドラーで行う。
      if (action.payload.queryType === `static`) {
        // 静的クエリの場合
        let staticQueryResult = state.trackedStaticQueryResults.get(
          action.payload.queryHash
        )
        if (!staticQueryResult) {
          staticQueryResult = {
            dirty: FLAG_DIRTY_STATIC_QUERY_FIRST_RUN,
            staticQueryResultHash: action.payload.resultHash,
          }
          state.trackedStaticQueryResults.set(
            action.payload.queryHash,
            staticQueryResult
          )
        } else if (
          staticQueryResult.staticQueryResultHash !== action.payload.resultHash
        ) {
          staticQueryResult.dirty |= FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED
          staticQueryResult.staticQueryResultHash = action.payload.resultHash
        }
      }

      return state
    }
    case `ADD_PAGE_DATA_STATS`: {
      const htmlFile = state.trackedHtmlFiles.get(action.payload.pagePath)
      if (!htmlFile) {
        // 不変条件
        throw new Error(
          `[html reducer] I received event that query for a page finished running, but I'm not aware of the page it ran for (?)`
        )
      }

      if (htmlFile.pageDataHash !== action.payload.pageDataHash) {
        htmlFile.pageDataHash = action.payload.pageDataHash
        htmlFile.dirty |= FLAG_DIRTY_DATA_CHANGED
      }
      return state
    }

    case `SET_WEBPACK_COMPILATION_HASH`: {
      if (!(_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES)) {
        if (state.browserCompilationHash !== action.payload) {
          state.browserCompilationHash = action.payload
          state.trackedHtmlFiles.forEach(htmlFile => {
            htmlFile.dirty |= FLAG_DIRTY_BROWSER_COMPILATION_HASH
          })
        }
      }
      return state
    }

    case `ADD_SLICE_DATA_STATS`: {
      const sliceProps = state.slicesProps.bySliceName.get(
        action.payload.sliceName
      )
      if (!sliceProps) {
        throw new Error(`no slice props for ${action.payload.sliceName}`)
      }

      if (sliceProps.sliceDataHash !== action.payload.sliceDataHash) {
        sliceProps.sliceDataHash = action.payload.sliceDataHash
        sliceProps.dirty |= FLAG_DIRTY_DATA_CHANGED
      }
      return state
    }

    case `SET_SSR_TEMPLATE_WEBPACK_COMPILATION_HASH`: {
      if (
        state.templateCompilationHashes[action.payload.templatePath] !==
        action.payload.templateHash
      ) {
        state.templateCompilationHashes[action.payload.templatePath] =
          action.payload.templateHash

        if (action.payload.isSlice) {
          for (const sliceName of action.payload.pages) {
            const sliceTemplate = state.slicesProps.bySliceName.get(sliceName)
            if (sliceTemplate) {
              sliceTemplate.dirty |= FLAG_DIRTY_SSR_COMPILATION_HASH
            }
          }
        } else {
          if (action.payload.pages) {
            action.payload.pages.forEach(pagePath => {
              const htmlFile = state.trackedHtmlFiles.get(pagePath)
              if (htmlFile) {
                htmlFile.dirty |= FLAG_DIRTY_SSR_COMPILATION_HASH
              }
            })
          } else {
            process.stdout.write(
              `---no pages for:\n${JSON.stringify(action.payload, null, 2)}\n`
            )
          }
        }
      }

      return state
    }

    case `SET_SSR_WEBPACK_COMPILATION_HASH`: {
      if (state.ssrCompilationHash !== action.payload) {
        state.ssrCompilationHash = action.payload
        // すべての html ファイルにダーティの印を付けるので、
        // unsafeBuiltinWasUsedInSSR フラグは安全にリセットできる。ssr バンドルが
        // 引き続きそれらを使っていれば、フラグは再び設定される
        state.unsafeBuiltinWasUsedInSSR = false
        state.trackedHtmlFiles.forEach(htmlFile => {
          htmlFile.dirty |= FLAG_DIRTY_SSR_COMPILATION_HASH
        })
      }
      return state
    }

    case `HTML_REMOVED`: {
      state.trackedHtmlFiles.delete(action.payload)
      return state
    }

    case `HTML_TRACKED_PAGES_CLEANUP`: {
      // これは、成果物の削除にはつながらないページパスのバリエーションを片付けるためのものである
      // たとえばページのパスが "/foo" から "/foo/" に変わる（またはその逆）場合、生成される成果物の
      // ファイル名は同じなので、ビルド後に削除したくはない。しかしその場合でもページパスは取り除くべきであり、
      // ここで状態を片付けておきたい。
      for (const path of action.payload) {
        state.trackedHtmlFiles.delete(path)
      }
      return state
    }

    case `HTML_GENERATED`: {
      for (const path of action.payload) {
        const htmlFile = state.trackedHtmlFiles.get(path)
        if (htmlFile) {
          htmlFile.dirty = 0
          // html を再生成した場合、スライスのプレースホルダーは空になっており、埋める必要が
          // あるので、そのページにつなぎ合わせ（stitching）の対象の印を付ける
          state.pagesThatNeedToStitchSlices.add(path)
        }
      }

      return state
    }

    case `HTML_MARK_DIRTY_BECAUSE_STATIC_QUERY_RESULT_CHANGED`: {
      // ページにダーティの印を付ける
      for (const path of action.payload.pages) {
        const htmlFile = state.trackedHtmlFiles.get(path)
        if (htmlFile) {
          htmlFile.dirty |= FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED
        }
      }

      if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
        // スライスにダーティの印を付ける
        for (const sliceName of action.payload.slices) {
          const sliceProps = state.slicesProps.bySliceName.get(sliceName)
          if (sliceProps) {
            sliceProps.dirty |= FLAG_DIRTY_STATIC_QUERY_RESULT_CHANGED
          }
        }
      }

      // 静的クエリのダーティの印を外す（ダーティの状態はページへ反映した）
      for (const staticQueryHash of action.payload.staticQueryHashes) {
        const staticQueryResult =
          state.trackedStaticQueryResults.get(staticQueryHash)
        if (staticQueryResult) {
          staticQueryResult.dirty = 0
        }
      }

      if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
        // スライス名を順に処理し、それぞれのスライスの props にダーティの印を付ける
        for (const sliceNameInfo of state.slicesProps.bySliceName.values()) {
          if (sliceNameInfo.dirty) {
            for (const sliceId of sliceNameInfo.props) {
              const slicePropInfo = state.slicesProps.bySliceId.get(sliceId)

              if (slicePropInfo) {
                slicePropInfo.dirty |= sliceNameInfo.dirty
              }
            }
            sliceNameInfo.dirty = 0
          }
        }
      }

      return state
    }

    case `SSR_USED_UNSAFE_BUILTIN`: {
      state.unsafeBuiltinWasUsedInSSR = true
      return state
    }

    case `SET_SLICES_PROPS`: {
      for (const [pagePath, slicesDataBySliceId] of Object.entries(
        action.payload
      )) {
        const newListOfSlices = new Set<string>()
        for (const [
          sliceId,
          { props, sliceName, hasChildren },
        ] of Object.entries(slicesDataBySliceId)) {
          newListOfSlices.add(sliceId)

          let sliceInfo = state.slicesProps.bySliceId.get(sliceId)
          if (!sliceInfo) {
            sliceInfo = {
              pages: new Set([pagePath]),
              props,
              sliceName,
              hasChildren,
              dirty: FLAG_DIRTY_NEW_ENTRY,
            }
            state.slicesProps.bySliceId.set(sliceId, sliceInfo)

            let existingBySliceName =
              state.slicesProps.bySliceName.get(sliceName)
            if (!existingBySliceName) {
              existingBySliceName = {
                dirty: 0,
                sliceDataHash: ``,
                props: new Set<string>(),
              }
              state.slicesProps.bySliceName.set(sliceName, existingBySliceName)
            }

            existingBySliceName.props.add(sliceId)
          } else {
            sliceInfo.pages.add(pagePath)

            if (hasChildren) {
              sliceInfo.hasChildren = true
            }
          }
        }

        const oldListOfSlices = state.slicesProps.byPagePath.get(pagePath)
        if (oldListOfSlices) {
          for (const sliceId of oldListOfSlices) {
            if (!newListOfSlices.has(sliceId)) {
              oldListOfSlices.delete(sliceId)
              const sliceInfo = state.slicesProps.bySliceId.get(sliceId)

              if (sliceInfo) {
                sliceInfo.pages.delete(pagePath)
              }
            }
          }
        }

        state.slicesProps.byPagePath.set(pagePath, newListOfSlices)
      }

      return state
    }

    case `SLICES_PROPS_REMOVE_STALE`: {
      for (const [
        sliceId,
        { pages, sliceName },
      ] of state.slicesProps.bySliceId.entries()) {
        if (pages.size <= 0) {
          state.slicesProps.bySliceId.delete(sliceId)
          const slicePropsListForThisSliceName =
            state.slicesProps.bySliceName.get(sliceName)
          if (slicePropsListForThisSliceName) {
            slicePropsListForThisSliceName.props.delete(sliceId)
          }
        }
      }
      return state
    }

    case `SLICES_PROPS_RENDERED`: {
      for (const { sliceId } of action.payload) {
        const sliceState = state.slicesProps.bySliceId.get(sliceId)
        if (sliceState) {
          sliceState.dirty = 0
          for (const pagePath of sliceState.pages) {
            state.pagesThatNeedToStitchSlices.add(pagePath)
          }
        }
      }
      return state
    }

    case `SLICES_SCRIPTS_REGENERATED`: {
      for (const [pagePath, htmlPageState] of state.trackedHtmlFiles) {
        if (!htmlPageState.isDeleted) {
          state.pagesThatNeedToStitchSlices.add(pagePath)
        }
      }
      return state
    }

    case `SLICES_STITCHED`: {
      state.pagesThatNeedToStitchSlices.clear()
      return state
    }
  }
  return state
}
