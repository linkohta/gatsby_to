import VirtualModulesPlugin from "webpack-virtual-modules"
import * as path from "path"
import * as fs from "fs-extra"
/*
 * このモジュールを使うと、仮想的な（メモリー上にだけある）モジュールやファイルを作成でき、
 * モジュールの本体を実際のファイルシステムに書き込まなくても、
 * webpack のコンパイルからアクセスできる。
 *
 * 最終的なビルドには含まれないが、最終的な成果物を生成するために何らかの形で
 * 使われる中間の成果物（たとえば `async-requires.js`）に役立つ。
 *
 * 仮想モジュールを使うと、それらのモジュールを読み書きするための不要な I/O を避けられる。
 * しかしそれ以上に重要なのは、webpack の監視モードで無効化イベントが即座に得られることである
 * （ファイルシステムを使う場合の、デバウンスされた遅延のあるイベントとは対照的である）。
 * 無効化イベントが即座に得られると、`gatsby develop` の実行中に起きる外部のイベントに
 * 応じたさまざまな状態遷移が、ずっと扱いやすくなる。
 */

interface IGatsbyWebpackVirtualModulesContext {
  writeModule: VirtualModulesPlugin[`writeModule`]
}

const fileContentLookup: Record<string, string> = {}
const instances: Array<IGatsbyWebpackVirtualModulesContext> = []

export const VIRTUAL_MODULES_BASE_PATH = `.cache/_this_is_virtual_fs_path_`

export class GatsbyWebpackVirtualModules {
  apply(compiler): void {
    const virtualModules = new VirtualModulesPlugin(fileContentLookup)
    virtualModules.apply(compiler)
    instances.push({
      writeModule: virtualModules.writeModule.bind(virtualModules),
    })
  }
}

export function getAbsolutePathForVirtualModule(filePath: string): string {
  return path.join(process.cwd(), VIRTUAL_MODULES_BASE_PATH, filePath)
}

export function writeModule(filePath: string, fileContents: string): void {
  const adjustedFilePath = getAbsolutePathForVirtualModule(filePath)

  if (fileContentLookup[adjustedFilePath] === fileContents) {
    // これはすでにあるので、無効化を発生させる必要はない
    return
  }

  // これらのファイルは実際には存在しないので、webpack は仮想モジュールを削除済みとして印を付けてしまう。その回避策である
  // そこで、watchpack が最初から存在しないものとして印を付けないように、それらのファイルを作成する
  fs.outputFileSync(adjustedFilePath, fileContents)

  fileContentLookup[adjustedFilePath] = fileContents

  instances.forEach(instance => {
    instance.writeModule(adjustedFilePath, fileContents)
  })
}
