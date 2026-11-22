/**
 * CSS の文字列をオブジェクト記法に変換する
 * @param strings
 * @param keys
 * @returns {Object} オブジェクト記法の CSS
 * @example
 * const output = css`
 *  html {
 *    color: rebeccapurple;
 *  }
 * `
 */
export function css(strings, ...keys) {
  const lastIndex = strings.length - 1
  return (
    strings.slice(0, lastIndex).reduce((p, s, i) => p + s + keys[i], ``) +
    strings[lastIndex]
  )
}
