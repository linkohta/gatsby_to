"use strict"

const path = require(`path`)
const fs = require(`fs`)
const normalizePath = require(`normalize-path`)
const visit = require(`unist-util-visit`)
const rangeParser = require(`parse-numeric-range`)

// 言語のデフォルトは extension.toLowerCase() である。
// この map は、拡張子と一致しない言語を保持する。
const FILE_EXTENSION_TO_LANGUAGE_MAP = {
  js: `jsx`,
  md: `markup`,
  sh: `bash`,
  rb: `ruby`,
  rs: `rust`,
  py: `python`,
  ps1: `powershell`,
  psm1: `powershell`,
  bat: `batch`,
  h: `c`,
  tex: `latex`,
  csproj: `xml`,
}

const getLanguage = file => {
  if (!file.includes(`.`)) {
    return `none`
  }

  const extension = file.split(`.`).pop()

  return FILE_EXTENSION_TO_LANGUAGE_MAP.hasOwnProperty(extension)
    ? FILE_EXTENSION_TO_LANGUAGE_MAP[extension]
    : extension.toLowerCase()
}

module.exports = ({ markdownAST, markdownNode }, { directory } = {}) => {
  if (!directory) {
    directory = path.dirname(markdownNode.fileAbsolutePath)
  }

  if (!fs.existsSync(directory)) {
    throw Error(`Invalid directory specified "${directory}"`)
  }

  visit(markdownAST, `inlineCode`, node => {
    const { value } = node

    if (value.startsWith(`embed:`)) {
      const file = value.slice(6)
      let snippetPath = normalizePath(path.join(directory, file))

      // ファイルの特定の行番号だけを埋め込む
      let lines = []
      let sname = ``
      const rangePrefixIndex = snippetPath.indexOf(`#L`)
      if (rangePrefixIndex > -1) {
        const range = snippetPath.slice(rangePrefixIndex + 2)
        if (range.length === 1) {
          lines = [Number.parseInt(range, 10)]
        } else {
          lines = rangeParser(range)
        }
        // ファイルパスから、範囲のプレフィックス以降をすべて取り除く
        snippetPath = snippetPath.slice(0, rangePrefixIndex)
      } else {
        // ファイルパスの後に {snippet: "snippetName"} が続いているかを確認する。
        // この構文は将来、追加のオプションに対応する可能性があるが、今のところは
        // `snippet :` オプションを含む文字列だけを扱う。
        const optionIndex = snippetPath.indexOf(`{`)
        if (optionIndex > -1) {
          const optionStr = snippetPath.slice(optionIndex)
          snippetPath = snippetPath.slice(0, optionIndex)
          try {
            const optVal = JSON.parse(
              optionStr.replace(/snippet\s*:/, `"snippet":`)
            )
            if (
              typeof optVal != `undefined` &&
              typeof optVal.snippet != `undefined`
            ) {
              sname = optVal.snippet
            } else {
              throw Error(`Invalid snippet options specified: ${optionStr}`)
            }
          } catch (err) {
            throw Error(`Invalid snippet options specified: ${optionStr}`)
          }
        }
      }

      if (!fs.existsSync(snippetPath)) {
        throw Error(`Invalid snippet specified; no such file "${snippetPath}"`)
      }

      let code = fs.readFileSync(snippetPath, `utf8`).trim()
      if (lines.length) {
        code = code
          .split(`\n`)
          .filter((_, lineNumber) => lines.includes(lineNumber + 1))
          .join(`\n`)
      } else if (sname.length) {
        const startSnippetMatcher = new RegExp(
          `start-snippet{${sname}}[^\r\n]*[\r\n](.*)`,
          `gs`
        )
        const startSnippetMatch = startSnippetMatcher.exec(code)
        if (startSnippetMatch?.length >= 2) {
          code = startSnippetMatch[1]

          const endSnippetMatcher = new RegExp(
            `(.*)[\r\n][^\r\n]*end-snippet{${sname}}`,
            `gs`
          )
          const endSnippetMatch = endSnippetMatcher.exec(code)
          if (endSnippetMatch?.length >= 2) {
            code = endSnippetMatch[1]
          }
        } else {
          code = ``
        }
      }

      // PrismJS のテーマのスタイルは、pre[class*="language-"] を対象に
      // スタイルを適用する。ここでも同じようにして、ユーザーが
      // PrismJS のテーマを適用するだけで、追加の CSS なしに、期待どおりの
      // すぐに使える結果を得られるようにする。
      //
      // @see https://github.com/PrismJS/prism/blob/1d5047df37aacc900f8270b1c6215028f6988eb1/themes/prism.css#L49-L54
      const language = getLanguage(snippetPath)

      // ノードの種類を code に変更し、ファイルの内容を value に入れて、言語を設定する。
      node.type = `code`
      node.value = code
      node.lang = language
    }
  })

  return markdownAST
}
