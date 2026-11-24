import { createStore, combineReducers, Store, AnyAction } from "redux"
import { reducer as logsReducer } from "./reducers/logs"
import { reducer as pageTreeReducer } from "./reducers/page-tree"
import { ActionsUnion, ISetLogs, IGatsbyCLIState } from "./types"
import { isInternalAction } from "./utils"
import { createStructuredLoggingDiagnosticsMiddleware } from "./diagnostics"
import { Actions } from "../constants"
import { IRenderPageArgs } from "../../reporter/types"

// redux 5 では `Store` の既定のアクションの型が `UnknownAction` になり、インターフェースで定義した
// アクションを渡せなくなる。redux 4 の既定と同じ `AnyAction` を明示する
let store: Store<
  { logs: IGatsbyCLIState; pageTree: IRenderPageArgs },
  AnyAction
> = createStore(
  combineReducers({
    logs: logsReducer,
    pageTree: pageTreeReducer,
  }),
  {}
)

export type GatsbyCLIStore = typeof store
type StoreListener = (store: GatsbyCLIStore) => void
type ActionLogListener = (action: ActionsUnion) => any
type Thunk = (...args: Array<any>) => ActionsUnion

const storeSwapListeners: Array<StoreListener> = []
const onLogActionListeners = new Set<ActionLogListener>()

export const getStore = (): typeof store => store

const diagnosticsMiddleware =
  createStructuredLoggingDiagnosticsMiddleware(getStore)

export const dispatch = (action: ActionsUnion | Thunk): void => {
  if (!action) {
    return
  }

  if (Array.isArray(action)) {
    action.forEach(item => dispatch(item))
    return
  } else if (typeof action === `function`) {
    action(dispatch)
    return
  }

  action = {
    ...action,
    // @ts-ignore this is a typescript no-no..
    // このタイムスタンプは、おそらくどこからも使われていない。
    // ただし今のところ、構造化ログの統合テストがこれを期待しているので、
    // このまま残しておき、後で調べるほうが簡単である
    timestamp: new Date().toJSON(),
  } as ActionsUnion

  store.dispatch(action)

  diagnosticsMiddleware(action)

  if (isInternalAction(action)) {
    // 利用側（ipc、yurnalist、json ロガー）が、ステータスの内部的な追跡のためだけに
    // 必要なアクションを扱わなくて済むようにする
    return
  }
  for (const fn of onLogActionListeners) {
    fn(action)
  }
}

export const onStoreSwap = (fn: StoreListener): void => {
  storeSwapListeners.push(fn)
}

export const onLogAction = (fn: ActionLogListener): (() => void) => {
  onLogActionListeners.add(fn)

  return (): void => {
    onLogActionListeners.delete(fn)
  }
}

export const setStore = (s: GatsbyCLIStore): void => {
  s.dispatch({
    type: Actions.SetLogs,
    payload: store.getState().logs,
  } as ISetLogs)
  store = s
  storeSwapListeners.forEach(fn => fn(store))
}
