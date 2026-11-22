import {
  applyMiddleware,
  combineReducers,
  createStore,
  DeepPartial,
  Middleware,
  ReducersMapObject,
  Store,
} from "redux"
import _ from "lodash"

import { mett } from "../utils/mett"
import thunk, { ThunkMiddleware, ThunkAction, ThunkDispatch } from "redux-thunk"
import * as rawReducers from "./reducers"
import { writeToCache, readFromCache } from "./persist"
import { IGatsbyState, ActionsUnion, GatsbyStateKeys } from "./types"

const persistedReduxKeys = [
  `nodes`,
  `typeOwners`,
  `statefulSourcePlugins`,
  `status`,
  `components`,
  `jobsV2`,
  `staticQueryComponents`,
  `webpackCompilationHash`,
  `pageDataStats`,
  `pages`,
  `staticQueriesByTemplate`,
  `pendingPageDataWrites`,
  `queries`,
  `html`,
  `slices`,
  `slicesByTemplate`,
]

const reducers = persistedReduxKeys.reduce((acc, key) => {
  const rawReducer = rawReducers[key]
  acc[key] = function (state, action): any {
    if (action.type === `RESTORE_CACHE` && action.payload[key]) {
      return action.payload[key]
    } else {
      return rawReducer(state, action)
    }
  }

  return acc
}, rawReducers)

// アクション用のイベントエミッターを作成する
export const emitter = mett()

// キャッシュから古いノードデータを読み込む。
export const readState = (): IGatsbyState => {
  try {
    const state = readFromCache() as IGatsbyState
    if (state.nodes) {
      // nodesByType を作り直す
      state.nodesByType = new Map()
      state.nodes.forEach(node => {
        const { type } = node.internal
        if (!state.nodesByType.has(type)) {
          state.nodesByType.set(type, new Map())
        }
        // 上の `.has` と `.set` の呼び出しによって、これは安全である
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state.nodesByType.get(type)!.set(node.id, node)
      })
    }

    // jsonDataPaths は、ページごとのマニフェストへの変更で
    // 削除された。アップグレード後に初めて gatsby を実行する場合に
    // 対応するために、ここで明示的に削除する。
    delete state[`jsonDataPaths`]

    return state
  } catch (e) {
    return {} as IGatsbyState
  }
}

export interface IMultiDispatch {
  <T extends ActionsUnion | ThunkAction<any, IGatsbyState, any, ActionsUnion>>(
    action: Array<T>
  ): Array<T>
}

/**
 * アクションの配列を扱う Redux ミドルウェア
 */
const multi: Middleware<IMultiDispatch> =
  ({ dispatch }) =>
  next =>
  (action: ActionsUnion): ActionsUnion | Array<ActionsUnion> =>
    Array.isArray(action) ? action.filter(Boolean).map(dispatch) : next(action)

export type GatsbyReduxStore = Store<IGatsbyState> & {
  dispatch: ThunkDispatch<IGatsbyState, any, ActionsUnion> & IMultiDispatch
}

export const configureStore = (
  initialState: IGatsbyState
): GatsbyReduxStore => {
  const store = createStore(
    combineReducers<IGatsbyState>({ ...reducers }),
    initialState,
    applyMiddleware(thunk as ThunkMiddleware<IGatsbyState, ActionsUnion>, multi)
  )

  store.dispatch({
    type: `INIT`,
  })

  return store
}

export const store: GatsbyReduxStore = configureStore(
  process.env.GATSBY_WORKER_POOL_WORKER ? ({} as IGatsbyState) : readState()
)

/**
 * 一部のレデューサーを差し替えられるようにする（たとえば独自のデータストアを設定する場合）
 */
export function replaceReducer(
  customReducers: Partial<ReducersMapObject<IGatsbyState>>
): void {
  store.replaceReducer(
    combineReducers<IGatsbyState>({ ...reducers, ...customReducers })
  )
}

// 状態を永続化する。
export const saveState = (): void => {
  if (process.env.GATSBY_DISABLE_CACHE_PERSISTENCE) {
    // 上の環境変数が設定されている場合は、キャッシュを永続化しない。
    // これは、v8.serialize に関連して Node.js のバッファーサイズが kMaxLength を超え、
    // 致命的なクラッシュになるビルドを、一時的に通せるようにするためのものである
    return undefined
  }

  const state = store.getState()

  const sliceOfStateToPersist = _.pick(state, persistedReduxKeys)

  return writeToCache(sliceOfStateToPersist)
}

export const savePartialStateToDisk = (
  slices: Array<GatsbyStateKeys>,
  optionalPrefix?: string,
  transformState?: <T extends DeepPartial<IGatsbyState>>(state: T) => T
): void => {
  const state = store.getState()
  const contents = _.pick(state, slices)
  const savedContents = transformState ? transformState(contents) : contents

  return writeToCache(savedContents, slices, optionalPrefix)
}

export const loadPartialStateFromDisk = (
  slices: Array<GatsbyStateKeys>,
  optionalPrefix?: string
): DeepPartial<IGatsbyState> => {
  try {
    return readFromCache(slices, optionalPrefix) as DeepPartial<IGatsbyState>
  } catch (e) {
    // エラーは無視する。
  }
  return {} as IGatsbyState
}

store.subscribe(() => {
  const lastAction = store.getState().lastAction
  emitter.emit(lastAction.type, lastAction)
})
