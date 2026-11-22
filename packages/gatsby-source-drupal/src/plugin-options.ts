let options: Options = {}

type RenamedLangCode = {
  langCode: string
  as: string
}

type Options = {
  // TODO: すべてのオプションに型を付ける
  [key: string]: any
} & {
  languageConfig?: {
    enabledLanguages?: Array<string | RenamedLangCode>
    renamedEnabledLanguages?: Array<RenamedLangCode>
    filterByLanguages?: boolean
    defaultLanguage?: string
    translatableEntities?: Array<string>
    nonTranslatableEntities?: Array<string>
  }
}

const mutateOptions = (options: Options) => {
  if (options?.languageConfig?.enabledLanguages?.length) {
    // Drupal で名前を変更した言語コードに対応する
    options.languageConfig.enabledLanguages.forEach(lang => {
      if (typeof lang === `object`) {
        // 複合コードの as の langcode を、有効な言語の配列へ移す
        options!.languageConfig!.enabledLanguages!.push(lang.as)
        // 次に、複合の言語コードを別の配列へ移す
        options!.languageConfig!.renamedEnabledLanguages ||= []
        options!.languageConfig!.renamedEnabledLanguages.push(lang)
      }
    })

    // オブジェクト形式の有効な言語はすべて新しい配列へ移したので、enabledLanguages から取り除ける
    options.languageConfig.enabledLanguages =
      options.languageConfig.enabledLanguages.filter(
        lang => typeof lang === `string`
      )
  }

  return options
}

export const setOptions = (newOptions: Options) => {
  options = mutateOptions(newOptions)
}

export const getOptions = () => options
