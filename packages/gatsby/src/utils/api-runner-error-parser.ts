import { IMatch } from "../types"

const errorParser = ({ err }: { err: unknown }): IMatch => {
  const handlers = [
    {
      regex: /(.+) is not defined/m,
      cb: (match: RegExpMatchArray): IMatch => {
        return {
          id: `11330`,
          context: { sourceMessage: match[0], arg: match[1] },
        }
      },
    },
  ]

  let structured: IMatch | undefined
  let errorMessage: string | undefined

  // できるだけ多くの種類の err を処理しようとする。
  // err はプラグインから来ることもあるので、何を
  // 受け取るかは分からない
  if (Array.isArray(err)) {
    err = err[0]
  }
  if (err instanceof Error) {
    errorMessage = err.message
  }
  if (typeof err === `string`) {
    errorMessage = err
  }

  for (const { regex, cb } of handlers) {
    const matched = errorMessage?.match(regex)
    if (matched) {
      structured = {
        ...cb(matched),
      }
      break
    }
  }

  // 既知のエラーが見つからなかった場合
  if (!structured) {
    return {
      id: `11321`,
      context: { sourceMessage: errorMessage || `` },
      error: err instanceof Error ? err : undefined,
    }
  }

  return structured
}

export default errorParser
