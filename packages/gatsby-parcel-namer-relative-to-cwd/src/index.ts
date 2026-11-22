import { Namer } from "@parcel/plugin"
import { FilePath, Namer as NamerOpts } from "@parcel/types"
import defaultNamer from "@parcel/namer-default"
import * as path from "path"
import { slash } from "gatsby-core-utils"

const CONFIG = Symbol.for(`parcel-plugin-config`)
const defaultNamerOpts = defaultNamer[CONFIG] as NamerOpts<unknown>

export default new Namer({
  async name(opts): Promise<FilePath | null | undefined> {
    // @parcel/namer-default は、エントリーに応じて「共通の最上位」のディレクトリを探し、
    // それを出力の「相対ルート」にする。
    // つまり、エントリーを追加または削除すると出力のディレクトリ構造が変わり得るので、
    // 設定「だけ」では出力が決まらない。
    // 出力を決定的にするため、「ミドルウェア」の namer を追加している。ファイル名には
    // @parcel/namer-default を使うが、ディレクトリ構造は（場合によって）
    // 調整する。

    const relativePathFromDefaultNamer = await defaultNamerOpts.name(opts)
    if (relativePathFromDefaultNamer) {
      const mainEntry = opts.bundle.getMainEntry()
      if (!mainEntry) {
        return null
      }

      // 今のところ CWD をルートとして扱う。現在の gatsby の用途では
      // これで十分だが、ほかのさまざまなプロジェクトでは、設定可能にするか、
      // もっと賢くする（たとえば `src` や `lib` などのよくあるディレクトリに対応する）必要があるかもしれない
      const root = slash(process.cwd())

      const sourceRelativeToRoot = path.posix.relative(
        root,
        slash(path.dirname(mainEntry.filePath))
      )

      // newPath は "distDir" からの相対パスとして出力される。
      // エントリーとルートの間にあるディレクトリ構造を、distDir の中でも
      // 保ちたい
      const newPath = path.posix.join(
        sourceRelativeToRoot,
        path.basename(relativePathFromDefaultNamer)
      )

      return newPath
    }

    return null
  },
})
