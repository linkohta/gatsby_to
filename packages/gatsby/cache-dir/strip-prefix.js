/**
 * 文字列から接頭辞を取り除く。指定した接頭辞が見つからない場合は、
 * 入力の文字列をそのまま返す。
 */

export default function stripPrefix(str, prefix = ``) {
  if (!prefix) {
    return str
  }

  if (str === prefix) {
    return `/`
  }

  if (str.startsWith(`${prefix}/`)) {
    return str.slice(prefix.length)
  }

  return str
}
