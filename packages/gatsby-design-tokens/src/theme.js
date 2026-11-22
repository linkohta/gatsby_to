import {
  breakpointsArray as breakpoints,
  colors as colorsTokens,
  borders,
  fonts,
  fontSizes,
  fontWeights,
  letterSpacings,
  lineHeights,
  mediaQueries,
  space,
  radii,
  transition,
  shadows,
} from "./index"

// gatsby-theme-ui-theme-default
// gatsby-design-tokens を使った theme-ui のテーマを提供する

// colors
// theme-ui が必要とするキーで colors を拡張する
// https://theme-ui.com/theme-spec#color
const c = {
  ...colorsTokens,
  // 本文の前景色
  // _gatsby-design-tokens_ の _colors_ に今ある値を上書きする
  // 下の _heading_ キーも参照
  text: colorsTokens.grey[80], // colors.text.primary
  // 本文の背景色
  background: colorsTokens.white,
  // リンクやボタンなどに使う、ブランドのプライマリーカラー
  primary: colorsTokens.gatsby,
  // 別のスタイルに使う、ブランドのセカンダリーカラー
  secondary: colorsTokens.purple[40],
  // UI を強調するためのコントラストカラー
  accent: colorsTokens.orange[60],
  // 背景色との高いコントラストを必要としない背景、ボーダー、アクセントに使う淡い色
  muted: colorsTokens.grey[5],
  // theme-ui が必要とするキーはここまで

  // gatsby-design-tokens の colors.text には次のものがあり、
  // theme-ui のデフォルトの色 _text_ と衝突する
  // text.header と text.secondary を _heading_ と _textMuted_ として
  // 使えるようにすることで解決している
  heading: colorsTokens.text.header, // text.header
  textMuted: colorsTokens.text.secondary, // text.secondary
}

export const theme = {
  borders,
  breakpoints,
  colors: c,
  fonts,
  fontSizes,
  fontWeights,
  letterSpacings,
  lineHeights,
  mediaQueries,
  radii,
  shadows,
  space,
  transition,
}

export {
  c as colors,
  borders,
  breakpoints,
  fonts,
  fontSizes,
  fontWeights,
  letterSpacings,
  lineHeights,
  mediaQueries,
  radii,
  shadows,
  space,
  transition,
}
