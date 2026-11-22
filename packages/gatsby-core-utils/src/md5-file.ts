import { createMD5 } from "hash-wasm"
import * as fs from "fs-extra"

/**
 * 指定した filePath から MD5 ハッシュを作成する
 * @param filePath ファイルの絶対パス
 * @returns 16 進数形式の MD5 ハッシュ
 */
export const md5File = async (filePath: string): Promise<string> => {
  const md5hasher = await createMD5()

  return new Promise((resolve, reject) => {
    md5hasher.init()

    const fileInput = fs.createReadStream(filePath)

    fileInput.on(`error`, err => {
      reject(err)
    })

    fileInput.on(`data`, data => {
      md5hasher.update(data)
    })

    fileInput.on(`end`, () => {
      resolve(md5hasher.digest(`hex`))
    })
  })
}
