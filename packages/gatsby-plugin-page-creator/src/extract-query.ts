import { hasFeature } from "gatsby-plugin-utils"
import _ from "lodash"
import path from "path"
import {
  convertUnionSyntaxToGraphql,
  extractField,
  extractFieldWithoutUnion,
  switchToPeriodDelimiters,
} from "./path-utils"

// 入力の queryStringParent は、Model のことも完全な graphql クエリのこともある
// 最終的な結果は { allProducts { nodes { id }}} のような形になる
export function generateQueryFromString(
  queryOrModel: string,
  fileAbsolutePath: string,
  nodeIds?: Array<string>
): string {
  // TODO: 'fields' には重複したフィールドが含まれることがある。たとえば field{name},field{description} は field{name,description} にマージすべきである
  const fields = extractUrlParamsForQuery(fileAbsolutePath)

  // queryOrModel の先頭が大文字でない場合に備える
  const connectionQuery = _.camelCase(`all ${queryOrModel}`)

  const connectionArgs = nodeIds
    ? `(filter: { id: { in: ${JSON.stringify(nodeIds)} } })`
    : ``

  return `{${connectionQuery}${connectionArgs}{nodes{${fields}}}}`
}

// ファイルパスが `/fields__value` のとき、`{ fields: { value: 'foo' }}` のようなクエリ結果を受け取り、
// そのオブジェクトを `{ fields__value: 'foo' }` に変換する。個々のページのクエリ関数へ
// 値を渡すために必要である。
export function reverseLookupParams(
  queryResults: Record<string, Record<string, unknown> | string>,
  absolutePath: string
): Record<string, string> {
  const reversedParams = {
    // id は常に含める
    id: (queryResults.nodes ? queryResults.nodes[0] : queryResults).id,
  }

  absolutePath.split(path.sep).forEach(part => {
    const extracted = extractFieldWithoutUnion(part)

    extracted.forEach(extract => {
      if (extract === ``) return

      const results = _.get(
        queryResults.nodes ? queryResults.nodes[0] : queryResults,
        // __ をアクセサーの '.' に置き換える
        switchToPeriodDelimiters(extract)
      )
      reversedParams[extract] = results
    })
  })

  return reversedParams
}

// `/Users/site/src/pages/foo/{Model.id}/{Model.baz}` のようなものを `id,baz,internal{contentFilePath}` に変換する。
// プレフィックスやポストフィックスにも対応している。たとえば `/foo/prefix-{Model.id}` は `id` になる
function extractUrlParamsForQuery(createdPath: string): string {
  const parts = createdPath.split(path.sep)

  // クエリには必ず `id` を追加する
  if (parts.some(s => s.includes(`.id}`)) === false) {
    parts.push(`{Model.id}`)
  }

  // 機能が利用できる場合は、必ず internal { contentFilePath } を追加する
  if (hasFeature(`content-file-path`)) {
    parts.push(`{Model.internal__contentFilePath}`)
  }

  return parts
    .reduce<Array<string>>(
      (queryParts: Array<string>, part: string): Array<string> => {
        if (part.includes(`{`) && part.includes(`}`)) {
          const fields = extractField(part)
          const derived = fields.map(f => deriveNesting(f))

          return queryParts.concat(derived)
        }

        return queryParts
      },
      []
    )
    .join(`,`)
}

// 特殊な __ の構文を使ったファイル名から、入れ子を取り出す
// src/pages/{Model.fields__baz}.js => `fields{baz}`
// src/pages/{Model.fields__(File)__baz}.js => `fields{... on File {baz}}`
function deriveNesting(part: string): string {
  if (part.includes(`__`)) {
    return part
      .split(`__`)
      .reverse()
      .reduce((path: string, part: string): string => {
        // ユニオンへの対応を追加する
        path = convertUnionSyntaxToGraphql(path)

        if (path) {
          return `${part}{${path}}`
        }
        return `${part}${path}`
      }, ``)
  }
  return part
}
