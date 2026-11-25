// Lerna 7 以降は @lerna/project などの内部パッケージを公開していない。
// scripts/ が必要とするのは「ワークスペースのパッケージの一覧」と「パッケージ同士の依存関係」だけなので、
// ルートの package.json の workspaces から自前で求める。
const fs = require(`fs`)
const { execFileSync } = require(`child_process`)
const path = require(`path`)
const glob = require(`glob`)
const minimatch = require(`minimatch`)
const semver = require(`semver`)

const defaultRootPath = path.join(__dirname, `..`, `..`)

/**
 * ワークスペースのパッケージを、ディレクトリの順に並べて返す
 */
function getPackages(rootPath = defaultRootPath) {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(rootPath, `package.json`), `utf8`)
  )
  const patterns = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : rootPkg.workspaces.packages

  const locations = new Set()
  for (const pattern of patterns) {
    for (const match of glob.sync(`${pattern}/package.json`, {
      cwd: rootPath,
      absolute: true,
    })) {
      locations.add(path.dirname(path.normalize(match)))
    }
  }

  return Array.from(locations)
    .sort()
    .map(location => {
      const json = JSON.parse(
        fs.readFileSync(path.join(location, `package.json`), `utf8`)
      )
      return {
        name: json.name,
        version: json.version,
        private: Boolean(json.private),
        location,
        // 呼び出しのたびに新しいオブジェクトを返す。受け取った側が書き換えても、元の内容と比べられるようにするためである
        toJSON: () => JSON.parse(JSON.stringify(json)),
      }
    })
}

/**
 * npm に公開されるパッケージ（private でないもの）だけを返す
 */
function getPublicPackages(rootPath = defaultRootPath) {
  return getPackages(rootPath).filter(pkg => !pkg.private)
}

/**
 * パッケージごとに、依存しているワークスペース内のパッケージを { name, spec } の配列で返す。
 * Lerna 3 の PackageGraph と同じく、dependencies、devDependencies、optionalDependencies を見る
 * （peerDependencies は含めない）。
 */
function getLocalDependencies(packages) {
  const names = new Set(packages.map(pkg => pkg.name))
  const localDependencies = new Map()

  for (const pkg of packages) {
    const json = pkg.toJSON()
    const dependencies = {
      ...json.devDependencies,
      ...json.optionalDependencies,
      ...json.dependencies,
    }
    localDependencies.set(
      pkg.name,
      Object.keys(dependencies)
        .filter(name => names.has(name))
        .map(name => {
          return { name, spec: dependencies[name] }
        })
    )
  }

  return localDependencies
}

/**
 * 渡したパッケージに（間接的なものも含めて）依存しているパッケージの名前を返す。
 * Lerna と同じく、バージョンの範囲がワークスペース内のバージョンを満たす依存だけをたどる。
 */
function collectDependents(packages, names) {
  const versions = new Map(packages.map(pkg => [pkg.name, pkg.version]))
  const dependents = new Map(packages.map(pkg => [pkg.name, []]))

  for (const [name, dependencies] of getLocalDependencies(packages)) {
    for (const dependency of dependencies) {
      const isLinked =
        /^(file|link|workspace):/.test(dependency.spec) ||
        (semver.validRange(dependency.spec) !== null &&
          semver.satisfies(versions.get(dependency.name), dependency.spec, {
            includePrerelease: true,
          }))
      if (isLinked) {
        dependents.get(dependency.name).push(name)
      }
    }
  }

  const collected = new Set()
  const queue = Array.from(names)
  while (queue.length > 0) {
    for (const dependent of dependents.get(queue.shift()) || []) {
      if (!collected.has(dependent) && !names.has(dependent)) {
        collected.add(dependent)
        queue.push(dependent)
      }
    }
  }

  return collected
}

function git(args, rootPath) {
  return execFileSync(`git`, args, { cwd: rootPath, encoding: `utf8` }).trim()
}

/**
 * `lerna publish <bump>` が公開するパッケージを返す。
 *
 * Lerna 7 以降は変更の検出（@lerna/collect-updates）を API として公開していない。
 * `lerna changed` はバージョンの上げ方を引数で受け取れず、lerna.json の command.publish.bump を
 * 使ってしまうので、Lerna と同じ手順をここで行う。
 */
function collectPackagesToPublish(bump, rootPath = defaultRootPath) {
  const packages = getPackages(rootPath)
  const lernaConfig = JSON.parse(
    fs.readFileSync(path.join(rootPath, `lerna.json`), `utf8`)
  )

  // タグが 1 つもなければ、すべてのパッケージが対象になる
  if (git([`tag`], rootPath) === ``) {
    return packages
  }

  const described = git(
    [`describe`, `--always`, `--long`, `--dirty`, `--first-parent`],
    rootPath
  )
  const [, lastTagName, refCount] =
    /^(.*)-(\d+)-g[0-9a-f]+(?:-dirty)?$/.exec(described) || []

  // 現在の HEAD から到達できるタグがなければ、すべてのパッケージが対象になる
  if (!lastTagName) {
    return packages
  }

  // HEAD がリリース済みのコミットなら、公開するものはない
  if (refCount === `0`) {
    return []
  }

  const ignoreFilters = (lernaConfig.ignoreChanges || []).map(pattern =>
    minimatch.filter(`!${pattern}`, { matchBase: true, dot: true })
  )
  const hasDiff = pkg => {
    const diff = git(
      [
        `diff`,
        `--name-only`,
        lastTagName,
        `--`,
        path.relative(rootPath, pkg.location).split(path.sep).join(`/`),
      ],
      rootPath
    )
    if (diff === ``) {
      return false
    }
    return (
      ignoreFilters.reduce(
        (files, filter) => files.filter(filter),
        diff.split(`\n`)
      ).length > 0
    )
  }
  // プレリリースでないバージョンへ上げるときは、変更がなくてもプレリリース版のパッケージを公開する
  const needsBump = pkg =>
    !bump.startsWith(`pre`) && semver.prerelease(pkg.version) !== null

  const names = new Set(
    packages.filter(pkg => needsBump(pkg) || hasDiff(pkg)).map(pkg => pkg.name)
  )
  for (const name of collectDependents(packages, names)) {
    names.add(name)
  }

  return packages.filter(pkg => names.has(pkg.name))
}

module.exports = {
  getPackages,
  getPublicPackages,
  getLocalDependencies,
  collectDependents,
  collectPackagesToPublish,
}
