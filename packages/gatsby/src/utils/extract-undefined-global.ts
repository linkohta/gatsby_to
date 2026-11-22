/**
 * サーバーのコンテキストで使われた未定義のグローバル変数を、reference error から抽出する。
 */
export function extractUndefinedGlobal(error: ReferenceError): string {
  const match = error.message.match(
    /(window|document|localStorage|navigator|alert|location) is not defined/i
  )

  if (match && match[1]) {
    return match[1]
  }

  return ``
}
