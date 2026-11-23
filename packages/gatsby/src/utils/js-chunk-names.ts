import memoize from "memoizee"
import { kebabCase as _kebabCase } from "lodash"
import { murmurhash as _murmurhash } from "gatsby-core-utils/murmurhash"
import path from "path"
import { store } from "../redux"

const kebabCase: (string?: string) => string = memoize(_kebabCase)
const pathRelative: (from: string, to: string) => string = memoize(
  path.relative
)
const murmurhash: (str: string, seed: number) => number = memoize(_murmurhash)

// unified routes は、[] や {} を含むファイルへの対応を追加する。
// generateComponentChunkName の問題は、kebabCase を呼ぶと、
// そのような文字が取り除かれてしまうことである。そのため、
// 次のような構成のアプリでは、解決に失敗する
//
// src/pages/products/{id}.js（コレクションルート）
// src/pages/products/[...id].js（一致しない id が渡されたときにレンダリングされるはずのもの）
//
// この関数がないと、componentChunkName が重複してしまうので、/products/__ へのすべてのアクセスが
// このどちらか一方にしか解決されなくなる。この関数は、{} と [] が
// componentChunkName に残るようにする。これについてのテストもある。
function replaceUnifiedRoutesKeys(
  kebabedName: string,
  filePath: string
): string {
  let newString = kebabedName

  filePath.split(path.sep).forEach(part => {
    if (part[0] === `[` || part[0] === `{`) {
      const match = /(\[(.*)\]|\{(.*)\})/.exec(part)
      newString = newString.replace(
        `-${match![2] || match![3]}-`,
        `-${match![0]}-`
      )
    }
  })

  return newString
}

const chunkNameCache = new Map()
export function generateComponentChunkName(
  componentPath: string,
  kind: `component` | `slice` = `component`
): string {
  if (chunkNameCache.has(componentPath)) {
    return chunkNameCache.get(componentPath)
  } else {
    const { program } = store.getState()
    const directory = program?.directory || `/`
    let name = pathRelative(directory, componentPath)
    if (name.includes(`__contentFilePath`)) {
      name = name.replace(
        /__contentFilePath=([^&]*)/,
        (_match, contentFilePath) =>
          `__contentFilePath=${pathRelative(directory, contentFilePath)}`
      )
    }
    name = replaceUnifiedRoutesKeys(kebabCase(name), name)

    /**
     * ファイル名は 255 文字を超えてはならない
     * `component---` の分として 12 を引く
     * `.js.map` の分として 7 を引く
     * `-[hash].js` の分として 20 を引く
     */
    const maxLength = 215
    const shouldTruncate = name.length > maxLength

    /**
     * ファイル名が長すぎることによるエラーを防ぐために、名前を最大 60 文字に切り詰める。
     */
    if (shouldTruncate) {
      const hash = murmurhash(name, 0)
      name = `${hash}-${name.substring(name.length - 60)}`
    }

    const chunkName = `${kind}---${name}`

    chunkNameCache.set(componentPath, chunkName)

    return chunkName
  }
}
