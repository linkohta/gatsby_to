import path from "path"
import importFrom from "import-from"
import resolveFrom from "resolve-from"

export function getLmdb(): typeof import("lmdb") {
  // gatsby の lmdb を使えるか試し、使えなければ自前のバージョンを使う
  try {
    const gatsbyPkgRoot = path.dirname(
      resolveFrom(process.cwd(), `gatsby/package.json`)
    )

    return importFrom(gatsbyPkgRoot, `lmdb`) as typeof import("lmdb")
  } catch (err) {
    return require(`lmdb`)
  }
}
