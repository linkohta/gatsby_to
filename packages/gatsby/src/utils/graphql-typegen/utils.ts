import slugify from "slugify"
import _ from "lodash"
import { lexicographicSortSchema } from "graphql"
import type { GraphQLSchema } from "graphql"
import { IDefinitionMeta } from "../../redux/types"

type DefinitionName = string
type DefinitionMap = Map<DefinitionName, IDefinitionMeta>

/**
 * スキーマをソートして決定的にする（そのため、保存し直してもファイル全体は変わらず、加えた変更だけが差分になる）。たとえば、2 つのスキーマの差分を比較するテストなどで使える。
 */
export function stabilizeSchema(schema: GraphQLSchema): GraphQLSchema {
  return lexicographicSortSchema(schema)
}

export function sortDefinitions(
  a: IDefinitionMeta,
  b: IDefinitionMeta
): number {
  return a.name.localeCompare(b.name)
}

/**
 * Gatsby の内部では、関数 generateQueryName を使っている:
 * packages/gatsby/src/query/file-parser.js
 * この関数は、クエリが無名かどうかを推測するために、それを部分的に再実装している
 */
function guessIfUnnnamedQuery({
  isStaticQuery,
  name,
  filePath,
}: IDefinitionMeta): boolean {
  const queryType = isStaticQuery ? `static` : `page`
  const generatedQueryName = slugify(filePath, {
    replacement: ` `,
    lower: false,
  })
  const pattern = _.camelCase(`${queryType}-${generatedQueryName}`)
  return name.startsWith(pattern)
}

function guessIfThirdpartyDefinition({ filePath }: IDefinitionMeta): boolean {
  return /(node_modules|\.yarn|\.cache)/.test(filePath)
}

function isFragmentDefinition(def: IDefinitionMeta): boolean {
  return def.isFragment
}

function isThirdpartyFragment(def: IDefinitionMeta): boolean {
  return isFragmentDefinition(def) && guessIfThirdpartyDefinition(def)
}

/**
 * フラグメントでない限り、サードパーティーの定義やクエリは不要である。
 * また、無名のクエリが TS の型に入ることも避けたい。
 */
function isTargetDefinition(def: IDefinitionMeta): boolean {
  if (isThirdpartyFragment(def)) {
    return true
  }
  return !(guessIfThirdpartyDefinition(def) || guessIfUnnnamedQuery(def))
}

export function filterTargetDefinitions(
  defMap: DefinitionMap
): Map<string, IDefinitionMeta> {
  const defs: Array<[name: string, def: IDefinitionMeta]> = []
  for (const [name, def] of defMap) {
    if (isTargetDefinition(def)) {
      defs.push([name, def])
    }
  }
  return new Map(defs)
}
