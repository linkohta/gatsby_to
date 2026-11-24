import * as fs from "fs"
import * as path from "path"
import lmdbBundlingPatch from "../lmdb-bundling-patch"

// このローダーは lmdb の内部のコードを文字列として置き換えるので、実際にインストールされている
// lmdb のコードに対して置き換えが効くことを確かめる。lmdb を更新して内部のコードが変わったときに、
// エンジンのビルドではなく、このテストで気付けるようにするためである。
describe(`lmdb-bundling-patch`, () => {
  // lmdb の `exports` は `package.json` を公開していないので、エントリーのパスからルートを求める
  const lmdbEntry = require.resolve(`lmdb`)
  const lmdbFolder = `${path.sep}lmdb${path.sep}`
  const lmdbRoot = lmdbEntry.slice(
    0,
    lmdbEntry.lastIndexOf(lmdbFolder) + lmdbFolder.length - 1
  )
  const resourcePath = path.join(lmdbRoot, `dist`, `index.cjs`)
  const source = fs.readFileSync(resourcePath, `utf8`)

  const runLoader = (forcedBinaryModule?: string): string =>
    lmdbBundlingPatch.call(
      {
        resourcePath,
        _module: { resourceResolveData: { descriptionFileRoot: lmdbRoot } },
        getOptions: () => {
          return { forcedBinaryModule }
        },
      },
      source
    )

  it(`replaces the dynamic lookup of the native binary with a static require`, () => {
    const binary = path.join(lmdbRoot, `package.json`)
    const patched = runLoader(binary)

    expect(source).toContain(`(dirName)`)
    expect(patched).not.toContain(`loadNAPI__default["default"](dirName)`)
    expect(patched).toContain(`require("../package.json")`)
  })

  it(`replaces the lookup of the compression dictionary with a static require.resolve`, () => {
    const patched = runLoader(path.join(lmdbRoot, `package.json`))

    expect(source).toContain(`'./dict/dict.txt'`)
    expect(patched).not.toContain(`'./dict/dict.txt'`)
    expect(patched).toContain(
      `fs.readFileSync(require.resolve('../dict/dict.txt'))`
    )
  })
})
