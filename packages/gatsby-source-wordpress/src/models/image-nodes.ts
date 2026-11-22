import { createModel } from "@rematch/core"
import { stripImageSizesFromUrl } from "~/steps/source-nodes/fetch-nodes/fetch-referenced-media-items"
import { IRootModel } from "."

const imageNodes = createModel<IRootModel>()({
  state: {
    nodeMetaByUrl: {},
  },

  reducers: {
    setState(state, payload) {
      state = {
        ...state,
        ...payload,
      }

      return state
    },

    pushNodeMeta(state, { id, sourceUrl, modifiedGmt }) {
      const nodeUrl = stripImageSizesFromUrl(sourceUrl)
      // 同じ画像に対してサイズ違いの URL が複数ある場合に備え、
      // ルックアップテーブルを上書きしない
      if (!state.nodeMetaByUrl[nodeUrl]) {
        state.nodeMetaByUrl[nodeUrl] = {
          id,
          modifiedGmt,
        }
      }

      return state
    },
  },
  effects: () => {
    return {}
  },
})

export default imageNodes
