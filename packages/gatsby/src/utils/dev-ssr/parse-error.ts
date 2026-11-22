import { createErrorFromString } from "gatsby-cli/lib/reporter/errors"
import * as sysPath from "path"
import * as fs from "fs-extra"
import { slash } from "gatsby-core-utils/path"

const getPosition = function (stackObject: Array<string>): {
  filename: string
  line: number
  column: number
} {
  let filename = ``
  let line = 0
  let column = 0
  // JavaScript のエラースタックはまだ標準化されていないので、
  // スタックのパースを try/catch で囲み、予期しないスタックに
  // 出会った場合でも致命的にならないようにする。
  try {
    for (const stackLine of stackObject) {
      {
        // 次の形式かをテストする:
        // "    at Component (/Users/misiek/dev/gatsby/integration-tests/ssr/.cache/page-ssr/routes/render-page.js:4088:13)"
        const splitLine = stackLine.match(/(?:\()(.+):([0-9]+):([0-9]+)(?:\))$/)
        if (splitLine) {
          filename = splitLine[1]
          line = Number(splitLine[2])
          column = Number(splitLine[3])
          break
        }
      }

      {
        // 次の形式かをテストする:
        // "    at ssr/src/pages/bad-page.js:4:13"
        const splitLine = stackLine.match(/at (.+):([0-9]+):([0-9]+)$/)
        if (splitLine) {
          filename = splitLine[1]
          line = Number(splitLine[2])
          column = Number(splitLine[3])
          break
        }
      }

      {
        // 汎用の形式の抽出を試みる:
        // "<filepath>:<line>:<column>"
        const splitLine = stackLine.match(/(.+):([0-9]+):([0-9]+)/)
        if (splitLine) {
          filename = splitLine[1]
          line = Number(splitLine[2])
          column = Number(splitLine[3])
          break
        }
      }
    }
  } catch (err) {
    filename = ``
    line = 0
    column = 0
  }
  return {
    filename,
    line,
    column,
  }
}

export interface IParsedError {
  filename: string
  sourceContent: string
  message: string
  stack: string
  line: number
  column: number
}

export interface IErrorRenderMeta {
  codeFrame: string
  source: string
  line: number
  column: number
  sourceMessage?: string
  stack?: string
}

// コードは https://github.com/watilde/parse-error から借用して変更したもの
export const parseError = function ({
  err,
  directory,
  componentPath,
  htmlComponentRendererPath,
}: {
  err: Error
  directory: string
  componentPath: string
  htmlComponentRendererPath: string
}): IParsedError {
  // スタックトレースを、コンパイル後の位置ではなくソースファイルの位置を使うように変換する
  err = createErrorFromString(err, `${htmlComponentRendererPath}.map`)

  const stack = err.stack ? err.stack : ``
  const stackObject = stack.split(`\n`)
  const position = getPosition(stackObject)

  let relativeFileName = position.filename
  while (relativeFileName.startsWith(`/`)) {
    relativeFileName = relativeFileName.substring(1)
  }

  let filename = sysPath.join(directory, relativeFileName)

  // webpack は、スタックトレースの最初のセグメントとしてプロジェクト名を入れることが多い
  // そのため、filename / relativeFileName は正しくないことがある。そこで、存在するファイルを
  // 指しているかを確認し、最初のセグメントがプロジェクト名であれば取り除くことを試みる
  if (!fs.existsSync(filename)) {
    try {
      const projectName = fs.readJsonSync(
        sysPath.join(directory, `package.json`),
        `utf8`
      ).name

      if (relativeFileName.startsWith(projectName + sysPath.sep)) {
        relativeFileName = relativeFileName.substring(
          (projectName + sysPath.sep).length
        )
      }

      filename = sysPath.join(directory, relativeFileName)
    } catch (e) {
      // ここでできることはもうない
    }
  }

  let sourceContent
  try {
    sourceContent = fs.readFileSync(filename, `utf-8`)
  } catch (e) {
    sourceContent = null
  }

  // エラーはコンポーネントの中にあるとは限らないので、スタックトレースのファイルパスを
  // 優先する。ただし、ソースマップが失敗してファイルとして public/render-page.js しか
  // 得られなかった場合は、コンポーネントのファイルパスにフォールバックする。少なくとも
  // ユーザーの手がかりになるためである。
  const trueFileName = filename.includes(`render-page`)
    ? componentPath
    : filename

  return {
    filename: slash(sysPath.relative(directory, trueFileName)),
    sourceContent,
    message: err.message,
    stack: stack,
    line: position.line,
    column: position.column,
  }
}
