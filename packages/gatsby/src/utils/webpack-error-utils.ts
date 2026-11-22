import { Reporter } from "gatsby-cli/lib/reporter/reporter"
import { WebpackError, StatsCompilation, Module, NormalModule } from "webpack"
import { Stage as StageEnum } from "../commands/types"
import formatWebpackMessages from "react-dev-utils/formatWebpackMessages"

const stageCodeToReadableLabel: Record<StageEnum, string> = {
  [StageEnum.BuildJavascript]: `Generating JavaScript bundles`,
  [StageEnum.BuildHTML]: `Generating SSR bundle`,
  [StageEnum.DevelopHTML]: `Generating development SSR bundle`,
  [StageEnum.Develop]: `Generating development JavaScript bundle`,
}

interface IFileLocation {
  line: number
  column: number
}

interface IWebpackError {
  name: string
  message: string
  file?: string
  error?: {
    message: string
    loc?: {
      start: IFileLocation
      end: IFileLocation
    }
  }
  module: Module
  loc?: {
    start: IFileLocation
    end: IFileLocation
  }
}

interface ITransformedWebpackError {
  id: string
  filePath: string
  location?: {
    start: IFileLocation
    end: IFileLocation
  }
  context: {
    stage: StageEnum
    stageLabel: string
    sourceMessage?: string
    [key: string]: unknown
  }
}

const transformWebpackError = (
  stage: StageEnum,
  webpackError: WebpackError
): ITransformedWebpackError => {
  const castedWebpackError = webpackError as unknown as IWebpackError

  let location
  if (castedWebpackError.loc && castedWebpackError.loc.start) {
    location = {
      start: castedWebpackError.loc.start,
      end: castedWebpackError.loc.end,
    }
  }

  if (!location && castedWebpackError.error?.loc) {
    if (castedWebpackError.error.loc.start) {
      location = castedWebpackError.error.loc
    } else {
      location = {
        start: castedWebpackError.error.loc,
      }
    }
  }

  // スタックトレースから位置を取り出すことを試みる
  if (!location) {
    const matches = castedWebpackError.message.match(/\((\d+):(\d+)\)/)
    if (matches && matches[1] && matches[2]) {
      location = {
        start: {
          line: Number(matches[1]),
          column: Number(matches[2]),
        },
      }
    }
  }

  let id = `98123`
  const context: ITransformedWebpackError["context"] = {
    stage,
    stageLabel: stageCodeToReadableLabel[stage],
    // TODO 警告の場合と同じように formatWebpackMessages を使う
    sourceMessage:
      castedWebpackError.error?.message ?? castedWebpackError.message,
  }

  // モジュールが見つからない場合は、早めに処理を打ち切れる
  if (castedWebpackError.name === `ModuleNotFoundError`) {
    const matches =
      castedWebpackError.error?.message.match(
        /Can't resolve '(.*?)' in '(.*?)'/m
      ) ?? []

    id = `98124`
    context.packageName = matches?.[1]
    context.sourceMessage = matches?.[0]

    // エラーから Breaking change のメッセージを取り出す
    // webpack で変更された点についての追加情報が表示される
    const BreakingChangeRegex = /BREAKING CHANGE[\D\n\d]+$/
    if (BreakingChangeRegex.test(castedWebpackError.message)) {
      const breakingMatch =
        castedWebpackError.message.match(BreakingChangeRegex)

      context.deprecationReason = breakingMatch?.[0]
    }
  }

  return {
    id,
    filePath:
      (castedWebpackError?.module as NormalModule)?.resource ??
      castedWebpackError.file,
    location,
    context,
    // スタックトレースの表示には、ほとんどの場合、元のエラーを使う。
    // webpack のエラーの場合、スタックには webpack やローダー（たとえば
    // babel-loader）の内部が含まれ、ユーザーにとってあまり価値がないので、
    // 意図的に省いている。

    // error: webpackError?.error || webpackError,
  }
}

// Head API の導入により、modulePath が resourceQuery を持つことがあるので、この関数を使ってそれを取り除ける
const removeResourceQuery = (
  moduleName: string | undefined
): string | undefined => {
  const moduleNameWithoutQuery = moduleName?.replace(
    /(\?|&)export=(default|head)$/,
    ``
  )

  return moduleNameWithoutQuery
}

export const structureWebpackErrors = (
  stage: StageEnum,
  webpackError: WebpackError | Array<WebpackError>
): Array<ITransformedWebpackError> | ITransformedWebpackError => {
  if (Array.isArray(webpackError)) {
    return webpackError.map(e => transformWebpackError(stage, e))
  }

  return transformWebpackError(stage, webpackError)
}

export const reportWebpackWarnings = (
  warnings: StatsCompilation["warnings"] = [],
  reporter: Reporter
): void => {
  let warningMessages: Array<string> = []
  if (typeof warnings[0] === `string`) {
    warningMessages = warnings as unknown as Array<string>
  } else if (
    warnings[0]?.message &&
    removeResourceQuery(warnings[0]?.moduleName)
  ) {
    warningMessages = warnings.map(
      warning =>
        `${removeResourceQuery(warning.moduleName)}\n\n${warning.message}`
    )
  } else if (warnings[0]?.message) {
    warningMessages = warnings.map(warning => warning.message)
  }

  formatWebpackMessages({
    errors: [],
    warnings: warningMessages,
  }).warnings.forEach(warning => reporter.warn(warning))
}
