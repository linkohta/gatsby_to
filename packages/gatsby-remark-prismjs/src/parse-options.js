const rangeParser = require(`parse-numeric-range`)

module.exports = language => {
  if (!language) {
    return ``
  }
  if (language.split(`{`).length > 1) {
    const [splitLanguage, ...options] = language.split(`{`)
    let highlightLines = []
    let outputLines = []
    let showLineNumbersLocal = false
    let numberLinesStartAt
    let promptUserLocal
    let promptHostLocal
    // オプションは任意の順序で指定でき、省略もできる

    options.forEach(option => {
      option = option.slice(0, -1)
      const splitOption = option.replace(/ /g, ``).split(`:`)

      // オプションが行のハイライト用かを判定する
      if (splitOption.length === 1 && rangeParser(option).length > 0) {
        highlightLines = rangeParser(option).filter(n => n > 0)
      }
      // オプションが行番号用かを判定する
      // オプションは `numberLines: true` か `numberLines: <integer>` の形でなければならない
      // それ以外の場合は行番号を無効にする

      if (
        splitOption.length === 2 &&
        splitOption[0] === `numberLines` &&
        (splitOption[1].trim() === `true` ||
          Number.isInteger(parseInt(splitOption[1].trim(), 10)))
      ) {
        showLineNumbersLocal = true
        numberLinesStartAt =
          splitOption[1].trim() === `true`
            ? 1
            : parseInt(splitOption[1].trim(), 10)
      }
      if (splitOption.length === 2 && splitOption[0] === `promptHost`) {
        promptHostLocal = splitOption[1]
      }
      if (splitOption.length === 2 && splitOption[0] === `promptUser`) {
        promptUserLocal = splitOption[1]
      }
      if (splitOption.length === 2 && splitOption[0] === `outputLines`) {
        outputLines = rangeParser(splitOption[1].trim()).filter(n => n > 0)
      }
    })

    return {
      splitLanguage,
      highlightLines,
      showLineNumbersLocal,
      numberLinesStartAt,
      outputLines,
      promptUserLocal,
      promptHostLocal,
    }
  }

  return { splitLanguage: language }
}
