import { Actions, Reporter } from "gatsby"
import chokidar from "chokidar"
import { collectionExtractQueryString } from "./collection-extract-query-string"

/*
 * 開発中のユーザーは、collectionQuery を試行錯誤したり、ファイルの名前を
 * 変えたりすることがある。この関数はファイルを監視し、クエリ文字列が変わったら古い
 * ページを削除して、コレクションビルダーを再実行する。
 *
 * TODO: 新しい watcher を作らずに、gatsby-node の watcher を再利用できないか？ または、watchpack のように、
 *       単一のグローバルな内部 watcher でファイルを監視するのが「得意な」別のライブラリを使えないか。
 */
export function watchCollectionBuilder(
  absolutePath: string,
  previousQueryString: string,
  paths: Array<string>,
  actions: Actions,
  reporter: Reporter,
  rerunCollectionBuilder: () => void
): void {
  const watcher = chokidar.watch(absolutePath).on(`change`, () => {
    const queryString = collectionExtractQueryString(absolutePath, reporter)

    // ユーザーがページを生成するクエリを変更している場合は、古いページを削除して
    // ビルダーを再実行する必要がある。
    if (queryString !== previousQueryString) {
      // 1.  古い watcher を閉じる。コレクションビルダーを再実行すると、
      //     新しい watcher が作成されるからである。そのほうが実装が簡単である。
      watcher.close()

      // 2.  古いページを確実にすべて削除する
      paths.forEach(path =>
        actions.deletePage({ path, component: absolutePath })
      )

      // 3.  そして、もう一度実行する！
      rerunCollectionBuilder()
    }
  })
}
