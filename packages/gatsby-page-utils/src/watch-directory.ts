const Promise = require(`bluebird`)
import * as chokidar from "chokidar"
const { slash } = require(`gatsby-core-utils`)
import { createGlobWatchFilter } from "gatsby-core-utils/watch-globs"

export async function watchDirectory(
  path: string,
  glob: string | ReadonlyArray<string>,
  onNewFile: (path: string) => void,
  onRemovedFile: (path: string) => void
): Promise<void> {
  // chokidar 4 以降は glob を監視できないので、glob を親フォルダーの監視と絞り込みに置き換える
  const watchFilter = createGlobWatchFilter({ cwd: path })

  return new Promise(resolve => {
    chokidar
      .watch(watchFilter.add(glob), { cwd: path, ignored: watchFilter.ignored })
      .on(`add`, path => {
        path = slash(path)
        onNewFile(path)
      })
      .on(`unlink`, path => {
        path = slash(path)
        onRemovedFile(path)
      })
      .on(`ready`, () => resolve())
  })
}
