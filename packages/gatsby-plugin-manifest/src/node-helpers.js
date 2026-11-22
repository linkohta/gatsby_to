import * as fs from "fs"

/**
 * アイコンがファイルシステム上に存在するかを確認する
 *
 * @param {String} srcIcon アイコンのパス
 */
export function doesIconExist(srcIcon) {
  try {
    return fs.statSync(srcIcon).isFile()
  } catch (e) {
    if (e.code !== `ENOENT`) {
      throw e
    }

    return false
  }
}
