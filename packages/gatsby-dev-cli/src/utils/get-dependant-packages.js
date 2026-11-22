/**
 * 指定したパッケージに依存するパッケージの集合を再帰的に取得する。
 * 集合には、渡されたパッケージ自身も含まれる。
 */
const getDependantPackages = ({
  packageName,
  depTree,
  packagesToPublish = new Set(),
}) => {
  if (packagesToPublish.has(packageName)) {
    // パッケージが処理済みであれば早めに抜ける
    return packagesToPublish
  }

  packagesToPublish.add(packageName)
  const dependants = depTree[packageName]
  if (dependants) {
    dependants.forEach(dependant =>
      getDependantPackages({
        packageName: dependant,
        depTree,
        packagesToPublish,
      })
    )
  }

  return packagesToPublish
}

exports.getDependantPackages = getDependantPackages
