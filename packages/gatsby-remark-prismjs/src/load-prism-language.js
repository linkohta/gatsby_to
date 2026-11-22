const Prism = require(`prismjs`)
const prismComponents = require(`prismjs/components`)

// 言語名またはエイリアスから、言語の実際の名前を取得する
const getBaseLanguageName = (nameOrAlias, components = prismComponents) => {
  if (components.languages[nameOrAlias]) {
    return nameOrAlias
  }
  return Object.keys(components.languages).find(language => {
    const { alias } = components.languages[language]
    if (!alias) return false
    if (Array.isArray(alias)) {
      return alias.includes(nameOrAlias)
    } else {
      return alias === nameOrAlias
    }
  })
}

module.exports = function loadPrismLanguage(language) {
  const baseLanguage = getBaseLanguageName(language)

  if (!baseLanguage) {
    throw new Error(`Prism doesn't support language '${language}'.`)
  }

  if (Prism.languages[baseLanguage]) {
    // 読み込み済みの言語は読み込まない
    return
  }

  const languageData = prismComponents.languages[baseLanguage]

  if (languageData.option === `default`) {
    // デフォルトの言語は、すでに Prism によって読み込まれている
    return
  }

  if (languageData.require) {
    // 必要な言語を先に読み込む
    if (Array.isArray(languageData.require)) {
      languageData.require.forEach(loadPrismLanguage)
    } else {
      loadPrismLanguage(languageData.require)
    }
  }

  require(`prismjs/components/prism-${baseLanguage}.js`)
}

/* ユニットテスト用に公開している */
module.exports.getBaseLanguageName = getBaseLanguageName
