"use strict"

let mockResults = {}

export const resolveModuleExports = (
  input: unknown
): Array<string> | undefined => {
  // モックの結果を返す
  if (typeof input === `string`) {
    return mockResults[input]
  }

  // デフォルトの結果を返す
  if (typeof input !== `object`) {
    return []
  }

  // モックの結果を設定する
  mockResults = Object.assign({}, input)
  return undefined
}
