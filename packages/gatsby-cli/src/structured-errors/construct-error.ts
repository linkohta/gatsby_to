import stackTrace from "stack-trace"
import { errorSchema } from "./error-schema"
import {
  defaultError,
  ErrorId,
  errorMap,
  IErrorMapEntryPublicApi,
} from "./error-map"
import { sanitizeStructuredStackTrace } from "../reporter/errors"
import { IConstructError, IStructuredError } from "./types"

// 部分的なエラーの詳細を errorMap の情報とマージする
// 組み立てたオブジェクトをエラーのスキーマで検証する
const constructError = (
  { details: { id, ...otherDetails } }: IConstructError,
  suppliedErrorMap: Record<ErrorId, IErrorMapEntryPublicApi>
): IStructuredError => {
  let errorMapEntry = defaultError

  if (id) {
    // 元の errorMap を確認する。ID は上書きできない
    if (errorMap[id]) {
      errorMapEntry = errorMap[id]
    } else if (suppliedErrorMap[id]) {
      errorMapEntry = {
        type: `PLUGIN`,
        level: `ERROR`,
        ...suppliedErrorMap[id],
      }
    }
  }

  const type =
    typeof errorMapEntry.type === `function`
      ? errorMapEntry.type(otherDetails.context)
      : errorMapEntry.type

  // マージする
  const structuredError: IStructuredError = {
    context: {},
    ...otherDetails,
    ...errorMapEntry,
    type,
    text: errorMapEntry.text(otherDetails.context),
    stack: otherDetails.error
      ? sanitizeStructuredStackTrace(stackTrace.parse(otherDetails.error))
      : [],
    docsUrl: errorMapEntry.docsUrl || `https://gatsby.dev/issue-how-to`,
  }

  if (id) {
    structuredError.code = id
  }

  // 検証する
  const { error } = errorSchema.validate(structuredError)
  if (error) {
    console.log(`Failed to validate error`, error)
    process.exit(1)
  }

  return structuredError
}

export default constructError
