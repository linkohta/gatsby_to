import fs from "fs-extra"
import chokidar from "chokidar"
import nodePath from "path"
import { store } from "../redux"

/**
 * copyStaticDirs
 * --
 * static ディレクトリのファイルを public ディレクトリにコピーする
 */
export const copyStaticDirs = (): void => {
  // ストアにアクセスしてテーマを取得する
  const { flattenedPlugins } = store.getState()
  // 従来のテーマがある場合は、それだけを使う。なければプラグインで続行する
  const themesSet = flattenedPlugins.map(plugin => {
    return {
      themeDir: plugin.pluginFilepath,
      themeName: plugin.name,
    }
  })

  themesSet
    // テーマの static フォルダーの候補の配列を作成する
    .map(theme => nodePath.resolve(theme.themeDir, `static`))
    // 存在しない static フォルダーを取り除く
    .filter(themeStaticPath => fs.existsSync(themeStaticPath))
    // それぞれのフォルダーのファイルを、ユーザーのビルドにコピーする
    .map(folder =>
      fs.copySync(folder, nodePath.join(process.cwd(), `public`), {
        dereference: true,
      })
    )

  const staticDir = nodePath.join(process.cwd(), `static`)
  if (!fs.existsSync(staticDir)) return undefined
  return fs.copySync(staticDir, nodePath.join(process.cwd(), `public`), {
    dereference: true,
  })
}

/**
 * syncStaticDir
 * --
 * static ディレクトリの変更を public ディレクトリに同期するウォッチャーをセットアップする
 */
export const syncStaticDir = (): void => {
  const staticDir = nodePath.join(process.cwd(), `static`)
  chokidar
    .watch(staticDir)
    .on(`add`, path => {
      const relativePath = nodePath.relative(staticDir, path)
      fs.copy(path, `${process.cwd()}/public/${relativePath}`)
    })
    .on(`change`, path => {
      const relativePath = nodePath.relative(staticDir, path)
      fs.copy(path, `${process.cwd()}/public/${relativePath}`)
    })
}
