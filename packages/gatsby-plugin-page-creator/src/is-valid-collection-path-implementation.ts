import sysPath from "path"
import { Reporter } from "gatsby/reporter"
import { CODES, prefixId } from "./error-utils"

// このファイルは利用者向けのヘルパーである。コレクションのクエリを確実に行うための
// ファイルパスの構成に何らかの誤りがあると、利用者に向けてエラーをログに
// 出す。
//
// これがないと、利用者は不可解なエラーに遭遇することになる。
export function isValidCollectionPathImplementation(
  filePath: string,
  reporter: Reporter
): boolean {
  const parts = filePath.split(sysPath.sep)
  let passing = false
  let errors = 0

  parts.forEach(part => {
    if (!part.includes(`{`) && !part.includes(`}`)) return

    const model = Array.from(part.matchAll(/\{([a-zA-Z_]\w*)./g)) // 最初のドットより前の語を探す。例: Model
    const field = Array.from(part.matchAll(/.*?((?<=\w\.)[^}]*)}/g)) // 最初のドットより後のすべてを探す。例: foo__bar（不正な場合は foo.bar）
    try {
      if (
        model.length === 0 ||
        field.length === 0 ||
        model.length !== field.length
      ) {
        throw new Error(errorMessage(part))
      }

      const models = Array.from(model, m => m[1])
      const fields = Array.from(field, f => f[1])

      for (const m of models) {
        assert(m, /^[a-zA-Z_]\w*$/, errorMessage(part)) // Model が https://spec.graphql.org/draft/#sec-Names に従っていることを確認する
      }
      for (const f of fields) {
        assert(f, /^[a-zA-Z_][\w_()]*$/, errorMessage(part)) // field が foo__bar__baz の形（foo.bar.baz ではない）であり、https://spec.graphql.org/draft/#sec-Names に従っていることを確認する
      }
    } catch (e) {
      reporter.panicOnBuild({
        id: prefixId(CODES.CollectionPath),
        context: {
          sourceMessage: e.message,
        },
        filePath: filePath,
      })
      errors++
    }
  })

  if (errors === 0) {
    passing = true
  }

  return passing
}

function errorMessage(part: string): string {
  return `Collection page builder encountered an error parsing the filepath. To use collection paths the schema to follow is {Model.field__subfield}. The problematic part is: ${part}.`
}

function assert(part: string, matches: string | RegExp, message: string): void {
  const regexp = matches instanceof RegExp ? matches : new RegExp(matches)

  if (!part || regexp.test(part) === false) {
    throw new Error(message)
  }
}
