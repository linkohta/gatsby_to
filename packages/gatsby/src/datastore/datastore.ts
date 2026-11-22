import { IDataStore } from "./types"
import { emitter } from "../redux"

let dataStore: IDataStore

export function getDataStore(): IDataStore {
  if (!dataStore) {
    const { setupLmdbStore } = require(`./lmdb/lmdb-datastore`)
    dataStore = setupLmdbStore()
  }
  return dataStore
}

// `DELETE_CACHE` を呼ぶ時点で、store がまだ初期化されていないことがある。
//  以下のコードは、正しい store からキャッシュを消去することを保証する
//  （主にテストに関係する）
emitter.on(`DELETE_CACHE`, () => {
  getDataStore()
})
