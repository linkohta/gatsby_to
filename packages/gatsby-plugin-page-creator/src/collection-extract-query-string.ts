import { generateQueryFromString } from "./extract-query"
import fs from "fs-extra"
import { Reporter } from "gatsby/reporter"
import { extractModel } from "./path-utils"
import { CODES, prefixId } from "./error-utils"

// この関数は、コレクションファイルのパスから、ページの元になるノードを取得する queryString を組み立てる。
// ファイルの中身は、削除された collectionGraphql が使われていないかを調べるためだけに読む
export function collectionExtractQueryString(
  absolutePath: string,
  reporter: Reporter,
  nodeIds?: Array<string>
): string | null {
  let queryString: string | null = null

  const modelType = extractModel(absolutePath)

  // 不正なパスに対してクエリを実行しようとすると、こうなることがある
  // パスの graphql の解決ロジックは、これを呼び出す前にパスを検証しないので、
  // このケースに到達しうる。
  if (!modelType) return null

  // 1.  ファイルを読み込み、collectionGraphql が使われているかを調べる
  const fileContents = fs.readFileSync(absolutePath).toString()

  // 2.  ユーザーが collectionGraphql 関数を使っている場合は、
  //     この機能が削除されたことを警告する必要がある
  if (
    fileContents.includes(`collectionGraphql`) ||
    fileContents.includes(`unstable_collectionGraphql`)
  ) {
    reporter.panicOnBuild({
      id: prefixId(CODES.CollectionGraphQL),
      context: {
        sourceMessage: `The "collectionGraphql" (or "unstable_collectionGraphql") API was removed. Please use the "createPages" API instead to filter collection routes.`,
      },
      filePath: absolutePath,
    })
  }

  // 3  ここが重要である。model またはクエリが得られるが、そこから実際の graphql の
  //    クエリを作成する必要がある。この generateQueryFromString の呼び出しがそれをすべて行う
  queryString = generateQueryFromString(modelType, absolutePath, nodeIds)

  return queryString
}
