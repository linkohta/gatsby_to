// 次の変換を行う:
//   `/foo/[id]/` => `/foo/:id`
//   `/foo/[...id]/` => `/foo/*id`
//   `/foo/[...]/` => `/foo/*`
export function getMatchPath(srcPagesPath: string): string | undefined {
  if (srcPagesPath.includes(`[`) === false) return undefined
  const startRegex = /\[/g
  const endRegex = /\]/g
  const splatRegex = /\[\.\.\./g

  return srcPagesPath
    .replace(splatRegex, `*`)
    .replace(startRegex, `:`)
    .replace(endRegex, ``)
    .replace(/\/$/, ``)
}
