"use strict"

const URI = require(`urijs`)

const fs = require(`fs`)
const LZString = require(`lz-string`)
const { join } = require(`path`)
const map = require(`unist-util-map`)
const normalizePath = require(`normalize-path`)
const npa = require(`npm-package-arg`)

const {
  OPTION_DEFAULT_LINK_TEXT,
  PROTOCOL_BABEL,
  PROTOCOL_CODEPEN,
  PROTOCOL_CODE_SANDBOX,
  PROTOCOL_RAMDA,
  OPTION_DEFAULT_CODESANDBOX,
} = require(`./constants`)

// Babel と CodeSandbox の REPL で使われている圧縮方式に合わせている
// https://github.com/babel/website/blob/master/js/repl/UriUtils.js
const compress = string =>
  LZString.compressToBase64(string)
    .replace(/\+/g, `-`) // '+' を '-' に変換する
    .replace(/\//g, `_`) // '/' を '_' に変換する
    .replace(/=+$/, ``) // 末尾の '=' を取り除く

function convertNodeToLink(node, text, href, target) {
  target = target ? `target="${target}" rel="noreferrer"` : ``

  delete node.children
  delete node.position
  delete node.title
  delete node.url

  node.type = `html`
  node.value = `<a href="${href}" ${target}>${text}</a>`
}

module.exports = (
  { markdownAST },
  {
    directory,
    target,
    defaultText = OPTION_DEFAULT_LINK_TEXT,
    codesandbox = OPTION_DEFAULT_CODESANDBOX,
  } = {}
) => {
  codesandbox = { ...OPTION_DEFAULT_CODESANDBOX, ...codesandbox }
  if (!directory) {
    throw Error(`Required REPL option "directory" not specified`)
  } else if (!fs.existsSync(directory)) {
    throw Error(`Invalid REPL directory specified "${directory}"`)
  } else if (!directory.endsWith(`/`)) {
    directory += `/`
  }

  const getFilePath = (url, protocol, directory) => {
    let filePath = url.replace(protocol, ``)
    if (!filePath.includes(`.`)) {
      filePath += `.js`
    }
    filePath = normalizePath(join(directory, filePath))
    return filePath
  }

  const getMultipleFilesPaths = (urls, protocol, directory) =>
    urls
      .replace(protocol, ``)
      .split(`,`)
      .map(url => {
        if (!url.includes(`.`)) {
          url += `.js`
        }

        return {
          url, // ファイル名そのもの
          filePath: normalizePath(join(directory, url)), // 絶対パス
        }
      })

  const verifyFile = (path, protocol) => {
    if (protocol !== PROTOCOL_CODE_SANDBOX && path.split(`,`).length > 1) {
      throw Error(
        `Code example path should only contain a single file, but found more than one: ${path.replace(
          directory,
          ``
        )}. ` +
          `Only CodeSandbox REPL supports multiple files entries, the protocol prefix of which starts with ${PROTOCOL_CODE_SANDBOX}`
      )
    }
    if (!fs.existsSync(path)) {
      throw Error(`Invalid REPL link specified; no such file "${path}"`)
    }
  }

  const verifyMultipleFiles = (paths, protocol) =>
    paths.forEach(path => verifyFile(path.filePath, protocol))

  map(markdownAST, (node, index, parent) => {
    if (node.type === `link`) {
      if (node.url.startsWith(PROTOCOL_BABEL)) {
        const filePath = getFilePath(node.url, PROTOCOL_BABEL, directory)

        verifyFile(filePath, PROTOCOL_BABEL)

        const code = compress(fs.readFileSync(filePath, `utf8`))
        const href = `https://babeljs.io/repl/#?presets=react&code_lz=${code}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_CODEPEN)) {
        const filePath = getFilePath(node.url, PROTOCOL_CODEPEN, directory)

        verifyFile(filePath, PROTOCOL_CODEPEN)

        const href = node.url.replace(PROTOCOL_CODEPEN, `/redirect-to-codepen/`)
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_CODE_SANDBOX)) {
        const filesPaths = getMultipleFilesPaths(
          node.url,
          PROTOCOL_CODE_SANDBOX,
          directory
        )
        verifyMultipleFiles(filesPaths, PROTOCOL_CODE_SANDBOX)

        // CodeSandbox の GET API には、名前をキーにした "files" の一覧が必要である
        let parameters = {
          files: {
            "package.json": {
              content: {
                dependencies: codesandbox.dependencies.reduce(
                  (map, dependency) => {
                    const { name, fetchSpec } = npa(dependency)
                    map[name] = fetchSpec
                    return map
                  },
                  {}
                ),

                main: filesPaths[0].url,
              },
            },
            "index.html": {
              content: codesandbox.html,
            },
          },
        }

        filesPaths.forEach((path, i) => {
          const code = fs.readFileSync(path.filePath, `utf8`)
          parameters.files[path.url] = {
            content: code,
          }
        })

        // この設定の JSON は、さらに lz-string で圧縮する必要がある
        parameters = compress(JSON.stringify(parameters))

        const href = `https://codesandbox.io/api/v1/sandboxes/define?parameters=${parameters}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value

        convertNodeToLink(node, text, href, target)
      } else if (node.url.startsWith(PROTOCOL_RAMDA)) {
        const filePath = getFilePath(node.url, PROTOCOL_RAMDA, directory)

        verifyFile(filePath, PROTOCOL_RAMDA)

        // `compress()` は使わないこと。Ramda の REPL がその出力を解釈できないためである。
        // Ramda の REPL は URL 用のコードを URI でエンコードするので、ここでも同じようにする。
        const code = URI.encode(fs.readFileSync(filePath, `utf8`))
        const href = `http://ramdajs.com/repl/#?${code}`
        const text =
          node.children.length === 0 ? defaultText : node.children[0].value
        convertNodeToLink(node, text, href, target)
      }
    }

    // 変更なし
    return node
  })

  return markdownAST
}
