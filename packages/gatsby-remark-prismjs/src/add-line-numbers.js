const GATSBY_HIGHLIGHT_LINE_CLASS = /gatsby-highlight-code-line/g

module.exports = (code = []) => {
  // コードの行数と同じ数の `<span></span>` を生成する
  const generateSpans = numberOfLines => {
    let spans = ``
    for (let i = 0; i < numberOfLines; i++) {
      spans += `<span></span>`
    }
    return spans
  }

  const numberOfLines =
    code.length === 0
      ? 0
      : code.split(`\n`).length +
        (code.match(GATSBY_HIGHLIGHT_LINE_CLASS) || []).length

  // 行番号用のコンテナを生成する。
  // Prism の Line Numbers プラグインの該当コードは次の場所にある:
  // https://github.com/PrismJS/prism/blob/f356dfe71bf126e6dc060c03f3e042de28a9bec4/plugins/line-numbers/prism-line-numbers.js#L99-L115
  const lineNumbersWrapper =
    `<span aria-hidden="true" class="line-numbers-rows" style="white-space: normal; width: auto; left: 0;">` +
    `${generateSpans(numberOfLines)}` +
    `</span>`
  return lineNumbersWrapper
}
