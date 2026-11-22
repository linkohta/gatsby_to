/**
 * Windows では文字列を隠す（絵文字用）
 */
export const maybeUseEmoji = (input: string): string =>
  process.platform === `win32` ? `` : input
