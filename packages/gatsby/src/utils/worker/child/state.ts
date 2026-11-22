import { GatsbyStateKeys } from "../../../redux/types"
import { loadPartialStateFromDisk, store } from "../../../redux"

// loadPartialStateFromDisk(slices) を呼び出し、その結果で redux ストアを書き換える
export function setState(slices: Array<GatsbyStateKeys>): void {
  const res = loadPartialStateFromDisk(slices)

  Object.entries(res).forEach(([key, val]) => {
    store.getState()[key] = val
  })
}
