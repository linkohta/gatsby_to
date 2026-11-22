// ここでの `node` は Gatsby のノードである

import { createModel } from "@rematch/core"
import { IRootModel } from "."

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OnPageCreatedCallback = (node: any) => Promise<void>

export interface IStoredPage {
  path: string
  updatedAt: number
}

export interface IPreviewState {
  nodePageCreatedCallbacks: {
    [nodeId: string]: OnPageCreatedCallback
  }
  nodeIdsToCreatedPages: {
    [nodeId: string]: {
      page: IStoredPage
    }
  }
  pagePathToNodeDependencyId: {
    [pageId: string]: {
      nodeId: string
    }
  }
}

export interface IPreviewReducers {
  subscribeToPagesCreatedFromNodeById: (
    state: IPreviewState,
    payload: {
      nodeId: string
      sendPreviewStatus: OnPageCreatedCallback
      modified: string
    }
  ) => IPreviewState
  unSubscribeToPagesCreatedFromNodeById: (
    state: IPreviewState,
    payload: {
      nodeId: string
    }
  ) => IPreviewState
  clearPreviewCallbacks: (state: IPreviewState) => IPreviewState
  saveNodePageState: (
    state: IPreviewState,
    payload: {
      nodeId: string
      page: IStoredPage
    }
  ) => IPreviewState
}

const previewStore = createModel<IRootModel>()({
  state: {
    nodePageCreatedCallbacks: {},
    nodeIdsToCreatedPages: {},
    pagePathToNodeDependencyId: {},
  } as IPreviewState,

  reducers: {
    unSubscribeToPagesCreatedFromNodeById(
      state,
      {
        nodeId,
      }: {
        nodeId: string
      }
    ) {
      if (state.nodePageCreatedCallbacks?.[nodeId]) {
        delete state.nodePageCreatedCallbacks[nodeId]
      }

      return state
    },

    subscribeToPagesCreatedFromNodeById(
      state,
      {
        nodeId,
        sendPreviewStatus,
      }: {
        nodeId: string
        sendPreviewStatus: OnPageCreatedCallback
        modified: string
      }
    ) {
      // この nodeId に対するコールバックを保存する
      // この id を持つノードからページが作成されたときに、
      // コールバックが呼び出される
      state.nodePageCreatedCallbacks[nodeId] = sendPreviewStatus

      return state
    },

    clearPreviewCallbacks(state) {
      state.nodePageCreatedCallbacks = {}

      return state
    },

    saveNodePageState(
      state,
      {
        page,
        nodeId,
      }: {
        nodeId: string
        page: IStoredPage
      }
    ) {
      state.nodeIdsToCreatedPages[nodeId] = {
        page,
      }

      state.pagePathToNodeDependencyId[page.path] = {
        nodeId,
      }

      return state
    },
  },
  effects: () => {
    return {}
  },
})

export default previewStore
