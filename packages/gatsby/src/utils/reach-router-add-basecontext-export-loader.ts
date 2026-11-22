export default function (source: string): string {
  // 行っているのは、export の一覧に BaseContext を追加することだけである
  return source.replace(/export\s+{([^}]+)}/m, (match, exportList) => {
    // return `export { ${exportList}, BaseContext }`

    if (/[,\s]BaseContext[,\s]/.test(exportList)) {
      // BaseContext がすでに export の一覧にある場合は、何もしない。
      // これを書いている時点では BaseContext は export されていないが、
      // @reach/router の将来のバージョンで変わる可能性がある。
      // 同じものを複数回 export すると、次のパースエラーになるので
      // 避けたい:
      // "Module parse failed: Duplicate export 'BaseContext'"
      return match
    } else {
      return `export { ${exportList}, BaseContext }`
    }
  })
}
