// https://github.com/pmmmwh/react-refresh-webpack-plugin/blob/652a31a15396398f01b765d51108d1b0b1504282/client/utils/formatWebpackErrors.js
/**
 * @typedef {Object} WebpackErrorObj
 * @property {string} moduleIdentifier
 * @property {string} moduleName
 * @property {string} message
 */

const friendlySyntaxErrorLabel = `Syntax error:`

/**
 * エラーメッセージが構文エラーのものかを確認する。
 * @param {string} message Webpack の生のエラーメッセージ。
 * @returns {boolean} エラーメッセージが構文エラーのものかどうか。
 */
function isLikelyASyntaxError(message) {
  return message.indexOf(friendlySyntaxErrorLabel) !== -1
}

/**
 * Webpack のエラーメッセージを整える。
 *
 * この実装は [create-react-app](https://github.com/facebook/create-react-app/blob/edc671eeea6b7d26ac3f1eb2050e50f75cf9ad5d/packages/react-dev-utils/formatWebpackMessages.js) のものをもとにしている。
 * @param {string} message Webpack の生のエラーメッセージ。
 * @returns {string} 整形済みの Webpack のエラーメッセージ。
 */
function formatMessage(message) {
  let lines = message.split(`\n`)

  // Webpack がエラーと警告に付けたヘッダーを取り除く
  // https://github.com/webpack/webpack/blob/master/lib/ModuleError.js
  lines = lines.filter(function (line) {
    return !/Module [A-z ]+\(from/.test(line)
  })

  // 先頭の改行を取り除く
  if (lines.length > 2 && lines[1].trim() === ``) {
    lines.splice(1, 1)
  }

  // 重複した改行を取り除く
  lines = lines.filter(function (line, index, arr) {
    return (
      index === 0 || line.trim() !== `` || line.trim() !== arr[index - 1].trim()
    )
  })

  // ファイル名を整える
  lines[0] = lines[0].replace(/^(.*) \d+:\d+-\d+$/, `$1`)

  // ファイルやパッケージに関する冗長な "module not found" のメッセージを整える。
  if (lines[1] && lines[1].indexOf(`Module not found: `) === 0) {
    lines = [
      lines[0],
      lines[1]
        .replace(`Error: `, ``)
        .replace(`Module not found: Cannot find file:`, `Cannot find file:`),
    ]
  }

  message = lines.join(`\n`)

  // 構文エラーを整える
  message = message.replace(`SyntaxError:`, friendlySyntaxErrorLabel)

  // 内部のスタックはたいてい役に立たないので取り除く。
  // ただし、`webpack:` を含むスタックは除く。
  // 通常、webpack が生成したユーザーのコードに由来するためである。
  message = message.replace(
    /^\s*at\s((?!webpack:).)*:\d+:\d+[\s)]*(\n|$)/gm,
    ``
  ) // at ... ...:x:y
  message = message.replace(
    /^\s*at\s((?!webpack:).)*<anonymous>[\s)]*(\n|$)/gm,
    ``
  ) // at ... <anonymous>
  message = message.replace(/^\s*at\s<anonymous>(\n|$)/gm, ``) // at <anonymous>

  return message.trim()
}

/**
 * Webpack のエラーメッセージを読みやすい形式に整形する。
 * @param {Array<string | WebpackErrorObj>} errors Webpack のエラーメッセージの配列。
 * @returns {string[]} 整形済みの Webpack のエラーメッセージ。
 */
function formatWebpackErrors(errors) {
  let formattedErrors = errors.map(function (errorObjOrMessage) {
    // Webpack 5 のコンパイルエラーは記述子オブジェクトの形式なので、
    // 求める形式にするには各部分を連結する必要がある。
    if (typeof errorObjOrMessage === `object`) {
      return formatMessage(
        [errorObjOrMessage.moduleName, errorObjOrMessage.message].join(`\n`)
      )
    }
    // Webpack 4 のコンパイルエラーは文字列である
    return formatMessage(errorObjOrMessage)
  })
  if (formattedErrors.some(isLikelyASyntaxError)) {
    // 構文エラーがあれば、それだけを表示する。
    formattedErrors = formattedErrors.filter(isLikelyASyntaxError)
  }
  return formattedErrors
}

module.exports = formatWebpackErrors
