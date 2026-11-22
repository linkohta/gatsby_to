const DOCLET_PATTERN = /^@(\w+)(?:$|\s((?:[^](?!^@\w))*))/gim

const cleanDocletValue = str => {
  str = str.trim()
  if (str.endsWith(`}`) && str.startsWith(`{`)) str = str.slice(1, -1)
  return str
}

const isLiteral = str => /^('|"|true|false|\d+)/.test(str.trim())

/**
 * 文字列から doclets を取り除く
 */
export const cleanDoclets = desc => {
  desc = desc || ``
  const idx = desc.search(DOCLET_PATTERN)
  return (idx === -1 ? desc : desc.slice(0, idx)).trim()
}

/**
 * 文字列を受け取り、doclet の名前をキー、その「内容」を値とする
 * オブジェクトを返す。
 *
 * https://github.com/reactjs/react-docgen/blob/ee8a5359c478b33a6954f4546637312764798d6b/src/utils/docblock.js#L62 をもとにしている
 * doclets の末尾の \r を取り除くよう変更した
 */
const getDoclets = str => {
  const doclets = []
  let match = DOCLET_PATTERN.exec(str)
  let val

  for (; match; match = DOCLET_PATTERN.exec(str)) {
    val = match[2] ? match[2].replace(/\r$/, ``) : true
    const key = match[1]
    doclets.push({ tag: key, value: val })
  }
  return doclets
}

/**
 * description の doclets をオブジェクトへパースし、コメントを取り除く
 *
 * @param  {ComponentMetadata|PropMetadata} obj
 */
export const parseDoclets = obj => {
  const desc = obj.description || ``
  return getDoclets(desc) || Object.create(null)
}

function parseType(type) {
  if (!type) {
    return undefined
  }

  const { name, raw } = type

  if (name === `union`) {
    return {
      name,
      value: raw.split(`|`).map(v => {
        return { name: v.trim() }
      }),
    }
  }

  if (name === `enum`) {
    return { ...type }
  }

  if (raw) {
    return {
      name: raw,
    }
  }

  return { ...type }
}

/**
 * JSDoc の "doclets" を読み取り、その一部を prop の型データに適用する
 * これにより、パースエラーやパースできないデータを、JSDoc 形式の
 * コメントで「修正」できる
 *
 * @param  {Object} props     prop のメタデータのオブジェクトハッシュ
 * @param  {String} propName
 */
export const applyPropDoclets = prop => {
  prop.doclets.forEach(({ tag, value }) => {
    // prop の型を指定するための @type doclet
    // 文字列リテラルが指定されていれば、enum（oneOf）にもできる
    // 例: @type {("optionA"|"optionB")}
    if (tag === `type`) {
      value = cleanDocletValue(value)

      if (prop.type === undefined) {
        prop.type = {}
      }

      prop.type.name = value

      if (value[0] === `(`) {
        value = value
          .substring(1, value.length - 1)
          .split(`|`)
          .map(v => v.trim())
        const name = value.every(isLiteral) ? `enum` : `union`
        prop.type.name = name
        prop.type.value = value.map(value =>
          name === `enum` ? { value, computed: false } : { name: value }
        )
      }
      return
    }

    // prop を必須としてマークするには @required を使う
    // `.isRequired` を付けられないカスタムの propTypes で役立つ
    if (tag === `required` && value) {
      prop.required = true
      return
    }

    // prop のデフォルト値を指定するには @defaultValue を使う
    if ((tag === `default` || tag === `defaultValue`) && value != null) {
      prop.defaultValue = { value, computed: false }
      return
    }
  })

  // tsTypes または flowTypes を参照する
  if (prop.type === undefined) {
    prop.type = parseType(prop.tsType) || parseType(prop.flowType)
  }

  return prop
}
