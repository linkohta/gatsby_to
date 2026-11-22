import _ from "lodash"
import slugify, { Options as ISlugifyOptions } from "@sindresorhus/slugify"
import type { Reporter } from "gatsby/reporter"
import {
  extractFieldWithoutUnion,
  extractAllCollectionSegments,
  switchToPeriodDelimiters,
  removeFileExtension,
} from "./path-utils"

const doubleForwardSlashes = /\/\/+/g
// "/" の 0 回または 1 回に一致する
const indexRoute = /^\/?$/

// ファイルパスからページのパスを生成する
// product/{Product.id} => /product/:id（nodes.id から取得する）
// product/{Product.sku__en} => product/:sku__en（nodes.sku.en から取得する）
// blog/{MarkdownRemark.parent__(File)__relativePath}} => blog/:slug（nodes.parent.relativePath から取得する）
export async function derivePath(
  path: string,
  node: Record<string, any>,
  reporter: Reporter,
  slugifyOptions?: ISlugifyOptions,
  getFieldValue?: (node: Record<string, any>, fieldPath: string) => any
): Promise<{ errors: number; derivedPath: string }> {
  // 0. この関数はパスごとにノードの数だけ呼び出されるので、エラーは数えておき、呼び出し元の関数が 1 回だけエラーを throw する
  let errors = 0

  // 1. 渡されるパスには、ファイルの拡張子が含まれていてもよい
  let modifiedPath = removeFileExtension(path)

  // 2. { } の括弧で囲まれた slug の部分を取り出す。
  const slugParts = extractAllCollectionSegments(path)

  // 3. slug の部分ごとに、ノードのデータから実際の値を取得する
  for (const slugPart of slugParts) {
    // 3.a. foo__bar を foo.bar に変換する
    const cleanedField = extractFieldWithoutUnion(slugPart)[0]
    const key = switchToPeriodDelimiters(cleanedField)

    // 3.b ここで node.nodes を使うのは、特殊な graphql の group フィールドに対応しているためである。このフィールドではノードが 1 段深い階層に置かれる
    const groupNodes = _.get(node.nodes, `[0]${key}`)
    // すべてのノードがまだマテリアライズされていない場合（setFieldsOnGraphQLNodeType や createResolvers の中など）は、_.get でノードの値を取得するだけでは足りず、ヘルパー関数の nodeModel.getFieldValue を呼び出す必要がある。nodeModel は常に使えるとは限らない（渡されていない、利用できないなど）ので、この引数は省略可能にしてあり、省略時は _.get にフォールバックする。
    const singleNode = getFieldValue
      ? await getFieldValue(node, key)
      : _.get(node, key)
    const nodeValue = groupNodes || singleNode

    // 3.c キーがノードに存在しない場合は、エラーをログに出す
    if (nodeValue === undefined) {
      if (process.env.gatsby_log_level === `verbose`) {
        reporter.verbose(
          `Could not find value in the following node for key ${slugPart} (transformed to ${key}) for node:
    
            ${JSON.stringify(node, null, 2)}`
        )
      }

      errors++

      continue
    }

    // 3.d すべての値を安全に slugify する（URL の構造を保つため）
    const value = safeSlugify(nodeValue, slugifyOptions)

    // 3.e slug の該当部分を実際の値に置き換える
    modifiedPath = modifiedPath.replace(slugPart, value)
  }

  // 4. 最終的な URL に現れうる二重のスラッシュを取り除く
  modifiedPath = modifiedPath.replace(doubleForwardSlashes, `/`)

  // 5.a 最終的な URL が index のパスと見なせる場合は、"index" というファイル名の規約を使う
  if (indexRoute.test(modifiedPath)) {
    modifiedPath = `index`
  }

  const derivedPath = modifiedPath

  return {
    errors,
    derivedPath,
  }
}

// ノードの値が `foo/bar` のような slug として指定されている場合、slugify
// 関数はスラッシュを取り除いてしまう。これは、最終的な URL の構造に
// スラッシュが残るようにするためのハックである
function safeSlugify(
  nodeValue: string,
  slugifyOptions?: ISlugifyOptions
): string {
  // 渡される GraphQL のデータは数値のこともある
  const input = String(nodeValue)
  const tempArr = input.split(`/`)

  return tempArr.map(v => slugify(v, slugifyOptions)).join(`/`)
}
