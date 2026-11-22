const _ = require(`lodash`)
const path = require(`path`)

/**
 * @typedef {Object} TraversePackagesDepsReturn
 * @property {Object} depTree 指定したパッケージに依存するパッケージを調べるためのルックアップテーブル。
 * どのパッケージを公開する必要があるかの判断に使う。
 * @example
 * ```
 * {
 *   "gatsby-cli": Set(["gatsby"]),
 *   "gatsby-source-filesystem": Set(["gatsby-source-contentful", "gatsby-source-drupal", "gatsby-source-wordpress", etc])
 *   // no package have remark plugin in dependencies - so dependent list is empty
 *   "gatsby-transformer-remark": Set([])
 * }
 * ```
 */

/**
 * 監視するパッケージの最終的な一覧を組み立てる
 * 明示的に指定されたパッケージと、そのすべての依存が含まれる
 * あわせて、依存が変更されたときにどのパッケージを公開する必要があるかを
 * 後で判断するための依存グラフも作成する
 * @param {Object} $0
 * @param {String} $0.root Gatsby のモノレポのリポジトリのルートへのパス
 * @param {String[]} $0.packages 監視するパッケージの最初の配列
 * プロジェクトの依存から取り出すことも、`--packages` フラグで明示的に指定することもできる
 * @param {String[]} $0.monoRepoPackages Gatsby のモノレポにあるパッケージの配列
 * @param {String[]} [$0.seenPackages] すでに走査したパッケージの配列。
 * これにより、依存の取り出しが各パッケージにつき 1 回になり、
 * 無限ループを避けられる。
 * @param {DepTree} [$0.depTree] 依存グラフを再帰的に組み立てるために内部で使う。
 * @return {TraversePackagesDepsReturn}
 */
const traversePackagesDeps = ({
  packages,
  monoRepoPackages,
  seenPackages = [...packages],
  depTree = {},
  packageNameToPath,
}) => {
  packages.forEach(p => {
    let pkgJson
    try {
      const packageRoot = packageNameToPath.get(p)
      if (packageRoot) {
        pkgJson = require(path.join(packageRoot, `package.json`))
      } else {
        console.error(`"${p}" package doesn't exist in monorepo.`)
        // seenPackages から取り除く
        seenPackages = seenPackages.filter(seenPkg => seenPkg !== p)
        return
      }
    } catch (e) {
      console.error(`"${p}" package doesn't exist in monorepo.`, e)
      // seenPackages から取り除く
      seenPackages = seenPackages.filter(seenPkg => seenPkg !== p)
      return
    }

    const fromMonoRepo = _.intersection(
      Object.keys({ ...pkgJson.dependencies, ...pkgJson.optionalDependencies }),
      monoRepoPackages
    )

    fromMonoRepo.forEach(pkgName => {
      depTree[pkgName] = (depTree[pkgName] || new Set()).add(p)
    })

    // 無限ループを避けるため、まだ見ていないパッケージだけを走査する
    const newPackages = _.difference(fromMonoRepo, seenPackages)

    if (newPackages.length) {
      newPackages.forEach(depFromMonorepo => {
        seenPackages.push(depFromMonorepo)
      })

      traversePackagesDeps({
        packages: fromMonoRepo,
        monoRepoPackages,
        seenPackages,
        depTree,
        packageNameToPath,
      })
    }
  })
  return { seenPackages, depTree }
}

exports.traversePackagesDeps = traversePackagesDeps
