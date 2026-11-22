const Prism = require(`prismjs`)
const loadPrismLanguage = require(`./load-prism-language`)
const replaceStringWithRegex = require(`./replace-string-with-regexp`)

module.exports = languageExtensions => {
  // languageExtensions の配列を作成する（入力がオブジェクトの場合）
  languageExtensions = [].concat(languageExtensions)

  languageExtensions.forEach(l => {
    loadLanguageExtension(l)
  })
}

const loadLanguageExtension = languageExtension => {
  if (!isObjectAndNotArray(languageExtension)) {
    throw new Error(
      `A languageExtension needs to be defined as an object. Given config is not valid: ${JSON.stringify(
        languageExtension
      )}`
    )
  }

  if (!containsMandatoryProperties(languageExtension)) {
    throw new Error(
      `A languageExtension needs to contain 'language' and 'extend' or both and a 'definition'. Given config is not valid: ${JSON.stringify(
        languageExtension
      )}`
    )
  }

  // 'extend' プロパティだけが指定されている場合は、指定された extend の言語を拡張する。
  if (!languageExtension.language) {
    languageExtension.language = languageExtension.extend
  }

  // 設定で RegEx を 'string' として書けるよう、すべての文字列を正規表現オブジェクトに置き換える。
  if (languageExtension.definition) {
    languageExtension.definition = replaceStringWithRegex(
      languageExtension.definition
    )
  }

  // 'extend' プロパティが指定されている場合はその言語から始め、そうでなければ言語を一から追加する。
  if (!languageExtension.extend) {
    Prism.languages[languageExtension.language] = languageExtension.definition
  } else {
    // 言語がまだ読み込まれていなければ読み込む。
    loadPrismLanguage(languageExtension.extend)

    Prism.languages[languageExtension.language] = Prism.languages.extend(
      languageExtension.extend,
      languageExtension.definition
    )
  }

  if (languageExtension.hasOwnProperty(`insertBefore`)) {
    // 設定で RegEx を 'string' として書けるよう、すべての文字列を正規表現オブジェクトに置き換える。
    languageExtension.insertBefore = replaceStringWithRegex(
      languageExtension.insertBefore
    )

    Object.entries(languageExtension.insertBefore).forEach(([key, value]) => {
      Prism.languages.insertBefore(languageExtension.language, key, value)
    })
  }
}

const isObjectAndNotArray = extension =>
  // javascript では Array も Object である
  !Array.isArray(extension) && typeof extension === `object`

const containsMandatoryProperties = languageExtension => {
  // 'language' か 'extend' が必須である
  if (!(languageExtension.language || languageExtension.extend)) {
    return false
  }

  // 'definition' か 'insertBefore' が必須である
  if (!(languageExtension.definition || languageExtension.insertBefore)) {
    return false
  }

  // 'insertBefore' は、'extend' か 'definition' がなければ使えない。その場合、前に挿入する対象がない。
  if (
    languageExtension.insertBefore &&
    !(languageExtension.definition || languageExtension.extend)
  ) {
    return false
  }

  return true
}
