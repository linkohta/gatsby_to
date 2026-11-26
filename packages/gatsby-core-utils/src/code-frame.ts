import {
  codeFrameColumns as babelCodeFrameColumns,
  type Options,
} from "@babel/code-frame"

// `@babel/code-frame` は 8 で列の数え方を変えた。7 までは列が 1 始まりで、0 や未指定は
// 「列を指さない」という意味だったが、8 では 0 始まりになり、列を指さないときは null を渡す。
// Gatsby の各所は 7 の数え方で位置を渡しているので、表示されるコードフレームが変わらないように、
// ここで 7 の数え方から 8 の数え方へ読み替える。

export interface ICodeFramePosition {
  line: number
  // 1 始まり。0 や未指定は、列を指さずに行だけを強調する
  column?: number | null
}

export interface ICodeFrameLocation {
  start: ICodeFramePosition
  end?: Partial<ICodeFramePosition>
}

export type CodeFrameOptions = Options

/**
 * Babel のパーサーのエラーや AST のノードが持つ位置（列が 0 始まり）を、`codeFrameColumns` に
 * 渡す位置（列が 1 始まり）へ読み替える。読み替えずに渡すと、印が 1 文字左にずれ、
 * 行頭（列 0）を指す位置では印が付かなくなる。
 */
export function fromBabelPosition(position: {
  line: number
  column: number
}): ICodeFramePosition {
  return { line: position.line, column: position.column + 1 }
}

// `@babel/code-frame` が行を分けるときと同じ規則
const NEWLINE = /\r\n|[\n\r\u2028\u2029]/

type BabelLocation = Parameters<typeof babelCodeFrameColumns>[1]

/**
 * 列を 1 始まりで数えた位置を受け取って、コードフレームを作る。
 * 出力は `@babel/code-frame` 7 の `codeFrameColumns` と同じになる。ただし、複数行を強調するときの
 * 途中の行の印の長さは、7 では別の行の長さになっていたが、ここではその行の長さになる。
 */
export function codeFrameColumns(
  source: string,
  location: ICodeFrameLocation,
  options?: CodeFrameOptions
): string {
  // 7 と同じ規則で、省略された値を補う（終了位置は開始位置を引き継ぐ）
  const start: ICodeFramePosition = Object.assign(
    { column: 0, line: -1 },
    location.start
  )
  const end: ICodeFramePosition = Object.assign({}, start, location.end)
  const pointsAtColumn = Boolean(start.column)
  const isMultiLine = start.line !== end.line

  // 8 は、終了行がソースの行数を超えていると例外を投げる。7 は最後の行までを強調していた
  const lines = source.split(NEWLINE)
  end.line = Math.min(end.line, lines.length)

  let startColumn: number | null
  let endColumn: number | null
  if (!pointsAtColumn && (isMultiLine || start.column === end.column)) {
    // 行だけを強調する
    startColumn = null
    endColumn = null
  } else if (isMultiLine) {
    startColumn = (start.column as number) - 1
    endColumn =
      start.line === end.line
        ? // 終了行を切り詰めた結果 1 行になったときは、7 と同じく行末までを強調する
          (lines[start.line - 1]?.length ?? startColumn)
        : // 7 は、最後の行の先頭から終了列までを強調していた
          (end.column ?? null)
  } else {
    // 7 は、開始列から「終了列 - 開始列」個（計算できないときは 1 個）の印を付けていた
    const markerCount = (end.column as number) - (start.column as number) || 1
    startColumn = pointsAtColumn ? (start.column as number) - 1 : 0
    endColumn =
      start.column === end.column ? startColumn : startColumn + markerCount
  }

  // 8 の型定義は null の列を受け付けないが、実行時には「列を指さない」という意味で扱われる
  const babelLocation = {
    start: { line: start.line, column: startColumn },
    end: { line: end.line, column: endColumn },
  } as unknown as BabelLocation

  // 7 は、列が 0 で行だけを強調するときはメッセージを出さなかった（列が未指定のときはフレームの上に出す）
  const babelOptions =
    typeof location.start.column === `number` && startColumn === null
      ? { ...options, message: undefined }
      : options

  return babelCodeFrameColumns(source, babelLocation, babelOptions)
}
