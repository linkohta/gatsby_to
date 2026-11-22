import { tmpdir } from "os"
import report from "../reporter"

/**
 * この関数は、Windows でのカレントディレクトリのドライブレターが
 * 常に大文字（c: ではなく C:）になるようにする。
 *
 * 理由
 * 1. "true-case-path"、"normalize-path"、"slash" などのユーティリティは、Windows の
 * ドライブレターの扱いがそれぞれ異なる。"true-case-path" は大文字にするが、ほかはたいてい気にしない。
 * その結果、パスの正規化の結果がカレントディレクトリ（c: か C: か）によって変わり、
 * デバッグがとても難しい奇妙なバグとして現れる。
 *
 * コミュニティのプラグインやサイトのコードはこちらで制御できないので、ライブラリの
 * 組み合わせが異なっていても、すべてが動くようにしておくべきである。
 *
 * 関連: https://github.com/Profiscience/true-case-path/issues/3
 *
 * 2. ビルドは一部のパスをキャッシュに保存する。最初のビルドを "c:" のシェルから実行し、
 * 次のビルドを "C:" のシェルから実行すると、webpack の警告が大量に出ることがある。
 * webpack はモジュールのパスの大文字と小文字を区別するためである。
 */
export function ensureWindowsDriveLetterIsUppercase(): void {
  const cwd = process.cwd()
  const normalizedCwd = driveLetterToUpperCase(cwd)

  if (cwd !== normalizedCwd) {
    try {
      // カレントディレクトリが "c:\dir" のとき、"cd C:\dir" コマンドは何もしない
      // パスの大文字と小文字を実際に変えるには、ディレクトリを 2 回移動する必要がある
      process.chdir(tmpdir())
      process.chdir(normalizedCwd)
    } catch {
      // 元に戻す
      process.chdir(cwd)
    }

    if (normalizedCwd !== process.cwd()) {
      report.warn(
        report.stripIndent(`
          Your working directory has a lower case drive letter:
            "${cwd}".
          ---^
          For solid development experience, we recommend switching it to upper case:
            cd "C:\\"
            cd "${normalizedCwd}"
          (Windows requires two directory switches to change the case of the drive letter)
        `)
      )
    }
  }
}

function driveLetterToUpperCase(path: string): string {
  const segments = path.split(`:\\`)
  return segments.length > 1
    ? segments.shift()!.toUpperCase() + `:\\` + segments.join(`:\\`)
    : path
}
