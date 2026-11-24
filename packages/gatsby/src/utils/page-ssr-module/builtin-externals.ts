import mod from "module"

/**
 * Node.js の組み込みモジュールを、バンドルに含めず実行時に読み込むための webpack の externals を作る。
 *
 * `fs` だけは、エンジンが差し替える `_actualFsWrapper` を経由させる。
 * ESM 専用のパッケージは `node:fs` のように `node:` を付けて import するので、
 * 付いた名前も同じ扱いにする。登録がないと、webpack は `node:` を読み込めずにビルドが失敗する。
 */
export function getBuiltinModuleExternals(): Record<string, string> {
  return mod.builtinModules.reduce(
    (acc, builtinModule) => {
      const external =
        builtinModule === `fs`
          ? `global _actualFsWrapper`
          : `commonjs ${builtinModule}`

      acc[builtinModule] = external
      acc[`node:${builtinModule}`] = external

      return acc
    },
    {} as Record<string, string>
  )
}
