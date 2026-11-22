import { isCI } from "gatsby-core-utils"

// 一部の CI パイプラインは process.stdout.isTTY の状態を誤って報告し、
// 出力に不要な行が混ざる原因になる。isCI の確認を加えると改善する。
// @see https://github.com/prettier/prettier/blob/36aeb4ce4f620023c8174e826d7208c0c64f1a0b/src/utils/is-tty.js
export const isTTY = (): boolean => process.stdout.isTTY && !isCI()
