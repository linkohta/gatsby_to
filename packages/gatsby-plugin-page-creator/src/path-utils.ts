import { globby as glob } from "globby"

// 正規表現は https://spec.graphql.org/draft/#sec-Names をもとに作成した
// 先頭の文字は英字かアンダースコアのみ、残りは英字、アンダースコア、数字
const extractModelRegex = /\{([a-zA-Z_][\w]*)\./

// コレクションのマーカーを含む absolutePath から Model を取り出す。
// /foo/bar/{Model.bar} => Model
export function extractModel(absolutePath: string): string {
  const model = extractModelRegex.exec(absolutePath)

  // ここには到達しないはずだが、TS の都合で検証が必要である
  // ここでエラーを throw してはいけない。throw すると、isValidCollectionPathImplementation() ではなく onPreInit フックで捕捉されてしまう
  if (!model) {
    return ``
  }

  return model[1]
}

// パスの末尾からファイルの拡張子を取り除く
export function removeFileExtension(absolutePath: string): string {
  return absolutePath.replace(/\.[a-z]+$/, ``)
}

// 末尾のスラッシュを取り除く
export function stripTrailingSlash(str: string): string {
  return str.endsWith(`/`) ? str.slice(0, -1) : str
}

const curlyBracesContentsRegex = /\{.*?\}/g

// 絶対パスに含まれるすべての情報を、コレクションの各部分の配列として取り出す
// /foo/{Model.bar}/{Model.baz} => ['Model.bar', 'Model.baz']
export function extractAllCollectionSegments(
  absolutePath: string
): Array<string> {
  const slugParts = absolutePath.match(curlyBracesContentsRegex)

  // ここには到達しないはずだが、TS の都合で検証が必要である
  if (!slugParts) {
    throw new Error(
      `An error occurred building the slug parts. This is likely a bug within Gatsby and not your code. Please report it to us if you run into this.`
    )
  }

  return slugParts
}

const extractFieldWithoutUnionRegex = /\(.*\)__/g

/**
 * コレクションのマーカーである filePath の一部を受け取り、次のように変換する:
 * @param {string} filePart - URL の個々の部分
 * @returns {Array<string>} - 取り出したフィールドの配列を返す（"Unions" は変換済み）
 * @example
 * {Model.bar} => bar
 * {Model.field__bar} => field__bar
 * {Model.field__(Union)__bar} => field__bar
 */
export function extractFieldWithoutUnion(filePart: string): Array<string> {
  const extracts = extractField(filePart)

  return extracts.map(e => e.replace(extractFieldWithoutUnionRegex, ``))
}

const extractFieldRegexCurlyBraces = /[{}]/g
// 正規表現は https://spec.graphql.org/draft/#sec-Names をもとに作成した
// 先頭の文字は英字かアンダースコアのみ、残りは英字、アンダースコア、数字
const extractFieldGraphQLModel = /[a-zA-Z_][\w]*\./

/**
 * コレクションのマーカーである filePath の一部を受け取り、次のように変換する:
 * @param {string} filePart - URL の個々の部分
 * @returns {Array<string>} - 取り出したフィールドの配列を返す
 * @example
 * {Model.field__(Union)__bar} => field__(Union)__bar
 * Also works with lowercased model
 * {model.field} => field
 * Also works with prefixes/postfixes (due to the regex match)
 * prefix-{model.field} => field
 */
export function extractField(filePart: string): Array<string> {
  const content = filePart.match(curlyBracesContentsRegex)

  if (!content) {
    return [``]
  }

  return content.map(c =>
    c
      .replace(extractFieldRegexCurlyBraces, ``)
      .replace(extractFieldGraphQLModel, ``)
  )
}

const switchToPeriodDelimitersRegex = /__/g

// filePath のフィールドアクセサーを js の構文のアクセサーに変換するために使う。
// 例:
//   foo__bar => foo.bar
// 変換後は _.get で使える
export function switchToPeriodDelimiters(filePart: string): string {
  // アクセスをピリオドに置き換える
  return filePart.replace(switchToPeriodDelimitersRegex, `.`)
}

const convertUnionSyntaxToGraphqlRegex = /\(/g

// ファイルの一部を、`(Union)` のような形から `... on Union` に変換する
export function convertUnionSyntaxToGraphql(filePart: string): string {
  return filePart
    .replace(convertUnionSyntaxToGraphqlRegex, `... on `)
    .replace(/\)/g, ``)
}

// このファイルの複数のメソッドをつなげるための compose 関数
// 例:
// compose(extractFieldWithoutUnion, switchToPeriodDelimters)(`{Model.foo__bar}`)
export function compose(
  ...functions: Array<(filePart: string) => string>
): (filePart: string) => string {
  return (filePart: string): string =>
    functions.reduce((value, fn) => fn(value), filePart)
}

// globby を使って、コレクションルートを持つすべてのページファイルを見つける
// 指定されたパスの中で、いずれかのセグメントに波括弧で囲まれたテキストを含むファイルをすべて探したい
// 例: "{Collection.field}.tsx" や "{Collection.field}/nestedpage.tsx"
export const pagesGlob = `**/**\\{*\\}**(/**)`
export const findCollectionPageFiles = (
  pagesPath: string
): Promise<Array<string>> => glob(pagesGlob, { cwd: pagesPath })
