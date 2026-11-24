import * as path from "path"
import * as fs from "fs-extra"
import mod from "module"

// sharp は 0.33 から、ビルド済みのバイナリを `@img/sharp-<platform>-<arch>` に、libvips を
// `@img/sharp-libvips-<platform>-<arch>` に分けて配布している。asset-relocator がエンジンへ
// コピーするのは `.node` ファイルだけなので、そのままでは `.node` が libvips を読み込めず、
// エンジンで sharp を使えない。ここでは、`.node` と一緒にコピーする共有ライブラリを求める。

const SHARP_BINARY_PATH =
  /[/\\]@img[/\\]sharp-([^/\\]+)[/\\]lib[/\\][^/\\]+\.node$/
const SHARED_LIBRARY_FILE = /\.(so(\.\d+)*|dylib|dll)$/

export interface ISharedLibraryCopy {
  from: string
  to: string
}

const listSharedLibraries = (directory: string): Array<string> => {
  try {
    return fs
      .readdirSync(directory)
      .filter(file => SHARED_LIBRARY_FILE.test(file))
  } catch (e) {
    return []
  }
}

/**
 * エンジンにコピーされた sharp の `.node` ファイルについて、一緒にコピーする必要がある
 * 共有ライブラリの一覧を返す。sharp のバイナリでなければ、空の配列を返す。
 *
 * @param binarySourcePath コピー元の `.node` ファイル（`node_modules` の中）
 * @param binaryOutputPath コピー先の `.node` ファイル（エンジンの中）
 * @param runtimePlatformAndArch エンジンを実行する環境（例: `linux-x64`、`linuxmusl-arm64`、`darwin-arm64`、`win32-x64`）。
 *   ほかの環境向けのバイナリは、実行されないので対象にしない（libvips は 1 つで約 18 MB ある）
 */
export function getSharpSharedLibraries(
  binarySourcePath: string,
  binaryOutputPath: string,
  runtimePlatformAndArch: string
): Array<ISharedLibraryCopy> {
  const match = SHARP_BINARY_PATH.exec(binarySourcePath)
  if (!match) {
    return []
  }

  const platformAndArch = match[1]

  if (platformAndArch !== runtimePlatformAndArch) {
    return []
  }

  const copies: Array<ISharedLibraryCopy> = []
  const sourceDirectory = path.dirname(binarySourcePath)
  const outputDirectory = path.dirname(binaryOutputPath)

  // Windows 向けのパッケージは、DLL を `.node` と同じフォルダーに持っている
  for (const file of listSharedLibraries(sourceDirectory)) {
    copies.push({
      from: path.join(sourceDirectory, file),
      to: path.join(outputDirectory, file),
    })
  }

  let libvipsDirectory: string | undefined
  try {
    // libvips のパッケージは、`./lib` として、ライブラリのあるフォルダーの `index.js` を公開している
    libvipsDirectory = path.dirname(
      mod
        .createRequire(binarySourcePath)
        .resolve(`@img/sharp-libvips-${platformAndArch}/lib`)
    )
  } catch (e) {
    // libvips のパッケージがないプラットフォーム（Windows など）では、何もしない
  }

  if (libvipsDirectory) {
    // `.node` は、自分の位置からの相対パス `../../sharp-libvips-<platform>-<arch>/lib` で libvips を探す
    // （`node_modules/@img` の中での位置関係と同じ）。エンジンの中でも同じ位置関係になるように置く
    const libvipsOutputDirectory = path.join(
      outputDirectory,
      `..`,
      `..`,
      `sharp-libvips-${platformAndArch}`,
      `lib`
    )

    for (const file of listSharedLibraries(libvipsDirectory)) {
      copies.push({
        from: path.join(libvipsDirectory, file),
        to: path.join(libvipsOutputDirectory, file),
      })
    }
  }

  return copies
}
