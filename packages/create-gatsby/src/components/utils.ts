import stringLength from "string-length"
// ANSI と絵文字を考慮した文字列の長さ
import wordWrap from "ansi-wordwrap"

const DEFAULT_WIDTH = process.stdout.columns

export const wrap = (text: string, width = DEFAULT_WIDTH): string =>
  wordWrap(text, { width })

export function rule(char = `\u2501`, width = DEFAULT_WIDTH): string {
  return char.repeat(width)
}

export function center(
  text: string,
  padding = ` `,
  width = DEFAULT_WIDTH
): string {
  const pad = padding.repeat(Math.round((width - stringLength(text)) / 2))
  return pad + text
}
