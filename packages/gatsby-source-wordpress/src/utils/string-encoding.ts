// 入力文字列を Base 64 でエンコードする。
export const b64e = (input: string): string =>
  Buffer.from(input).toString(`base64`)
