const Prism = require(`prismjs`)
const loadPrismLanguage = require(`./load-prism-language`)
const handleDirectives = require(`./directives`)
const escapeHTML = require(`./escape-html`)
const unsupportedLanguages = new Set()

require(`prismjs/components/prism-diff`)
require(`prismjs/plugins/diff-highlight/prism-diff-highlight`)

module.exports = (
  language,
  code,
  additionalEscapeCharacters = {},
  lineNumbersHighlight = [],
  noInlineHighlight = false,
  diffLanguage = null
) => {
  // 言語を必要に応じて読み込む（ことを試みる）。
  if (!Prism.languages[language]) {
    try {
      loadPrismLanguage(language)
    } catch (e) {
      // 言語が読み込まれなかったので、処理を打ち切る。
      let message = null
      switch (language) {
        case `none`:
          return code // none に設定されている場合はエスケープしない。
        case `text`:
          message = noInlineHighlight
            ? `code block language not specified in markdown.`
            : `code block or inline code language not specified in markdown.`
          break
        default:
          message = `unable to find prism language '${language}' for highlighting.`
      }

      const lang = language.toLowerCase()
      if (!unsupportedLanguages.has(lang)) {
        console.warn(message, `applying generic code block`)
        unsupportedLanguages.add(lang)
      }
      return escapeHTML(code, additionalEscapeCharacters)
    }
  }

  // diffLanguage を必要に応じて読み込む（ことを試みる）。
  if (diffLanguage && !Prism.languages[diffLanguage]) {
    try {
      loadPrismLanguage(diffLanguage)
    } catch (e) {
      const message = `unable to find prism language '${diffLanguage}' for highlighting.`

      const lang = diffLanguage.toLowerCase()
      if (!unsupportedLanguages.has(lang)) {
        console.warn(message, `applying generic code block`)
        unsupportedLanguages.add(lang)
      }
      // diffLanguage が存在しない場合は無視する。
      diffLanguage = null
    }
  }

  const grammar = Prism.languages[language]
  const highlighted = Prism.highlight(
    code,
    grammar,
    diffLanguage ? `${language}-${diffLanguage}` : language
  )
  const codeSplits = handleDirectives(highlighted, lineNumbersHighlight)

  let finalCode = ``
  const lastIdx = codeSplits.length - 1 // ハイライトされた行の後には、改行文字を付け直さない
  // それらの行は display: block かつ全幅にする必要があるためである。

  codeSplits.forEach((split, idx) => {
    finalCode += split.highlight
      ? split.code
      : `${split.code}${idx == lastIdx ? `` : `\n`}`
  })
  return finalCode
}
