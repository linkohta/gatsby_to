// `true`、true、正の数に対して true を返す
// `false`、false、0、負の整数、その他すべてに対して false を返す
export function isTruthy(value: any): boolean {
  // Boolean の場合はそのまま返す
  if (typeof value === `boolean`) return value

  // null または undefined の場合は false を返す
  if (value === undefined || value === null) return false

  // 文字列が true または false の場合
  if (value.toLowerCase() === `true`) return true
  if (value.toLowerCase() === `false`) return false

  // 次に数値かどうかを調べる
  const number = parseInt(value, 10)
  if (isNaN(number)) return false
  if (number > 0) return true

  // デフォルトは false
  return false
}
