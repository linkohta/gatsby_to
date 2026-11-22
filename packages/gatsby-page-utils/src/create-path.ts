import { parse, posix } from "path"
import { slash } from "gatsby-core-utils/path"

export function createPath(
  filePath: string,
  withTrailingSlash: boolean = false,
  usePathBase: boolean = false
): string {
  const { dir, name, base } = parse(filePath)
  // コレクションルートにクライアント専用ルートも含まれる場合（例: {Product.name}/[...sku]）、
  // "name" は .. に、"ext" は .sku になる。そのため、[...sku] を得るには代わりに "base" を
  // 使う必要がある。usePathBase は collection-route-builder と gatsbyPath で "true" に設定される
  const parsedBase = base === `index` ? `` : base
  const parsedName = name === `index` ? `` : name
  const postfix = withTrailingSlash ? `/` : ``

  // 正規表現はスラッシュを前提にしているので、区切り文字をスラッシュに変換する
  return slash(
    posix.join(`/`, dir, usePathBase ? parsedBase : parsedName, postfix)
  )
}
