import * as fs from "fs-extra"
import * as t from "@babel/types"
import traverse from "@babel/traverse"
import { codeFrameColumns, SourceLocation } from "@babel/code-frame"
import report from "gatsby-cli/lib/reporter"
import { babelParseToAst } from "../utils/babel-parse-to-ast"
import { testImportError } from "../utils/test-import-error"
import { resolveModule, ModuleResolver } from "../utils/module-resolver"
import { maybeAddFileProtocol, resolveJSFilepath } from "./resolve-js-file-path"
import { preferDefault } from "./prefer-default"

const staticallyAnalyzeExports = (
  modulePath: string,
  resolver = resolveModule
): Array<string> => {
  let absPath: string | undefined
  const exportNames: Array<string> = []

  try {
    absPath = resolver(modulePath) as string
  } catch (err) {
    return exportNames // 存在しない
  }
  const code = fs.readFileSync(absPath, `utf8`) // ファイルの内容を取得する

  let ast
  try {
    ast = babelParseToAst(code, absPath)
  } catch (err) {
    if (err instanceof SyntaxError) {
      // 構文エラーを整形して出力する
      const codeFrame = codeFrameColumns(
        code,
        {
          start: (err as unknown as { loc: SourceLocation["start"] }).loc,
        },
        {
          highlightCode: true,
        }
      )

      report.panic(
        `Syntax error in "${absPath}":\n${err.message}\n${codeFrame}`
      )
    } else {
      // 構文エラーでなければ、そのまま投げる
      throw err
    }
  }

  let isCommonJS = false
  let isES6 = false

  // ファイルから export の名前を取り出す
  traverse(ast, {
    // ファイルが ES6 の import を使っているかを確認する
    ImportDeclaration: function ImportDeclaration() {
      isES6 = true
    },

    ExportNamedDeclaration: function ExportNamedDeclaration(astPath) {
      const declaration = astPath.node.declaration

      // `export const foo = bar` から foo を取得する
      if (
        declaration?.type === `VariableDeclaration` &&
        declaration.declarations[0]?.id.type === `Identifier`
      ) {
        isES6 = true
        exportNames.push(declaration.declarations[0].id.name)
      }

      // `export function foo()` から foo を取得する
      if (
        declaration?.type === `FunctionDeclaration` &&
        declaration.id?.type === `Identifier`
      ) {
        isES6 = true
        exportNames.push(declaration.id.name)
      }
    },

    // `export { foo } from 'bar'` から foo を取得する
    // `export { foo }` から foo を取得する
    ExportSpecifier: function ExportSpecifier(astPath) {
      isES6 = true
      const exp = astPath?.node?.exported
      if (!exp) {
        return
      }
      if (exp.type === `Identifier`) {
        const exportName = exp.name
        if (exportName) {
          exportNames.push(exportName)
        }
      }
    },

    // export default () => {}
    // export default function() {}
    // export default function foo() {}
    // const foo = () => {}; export default foo
    ExportDefaultDeclaration: function ExportDefaultDeclaration(astPath) {
      const declaration = astPath.node.declaration
      if (
        !t.isIdentifier(declaration) &&
        !t.isArrowFunctionExpression(declaration) &&
        !t.isFunctionDeclaration(declaration)
      ) {
        return
      }

      let name = ``
      if (t.isIdentifier(declaration)) {
        name = declaration.name
      } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
        name = declaration.id.name
      }

      const exportName = `export default${name ? ` ${name}` : ``}`
      isES6 = true
      exportNames.push(exportName)
    },

    AssignmentExpression: function AssignmentExpression(astPath) {
      const nodeLeft = astPath.node.left

      if (!t.isMemberExpression(nodeLeft)) {
        return
      }

      // 目印のプロパティ `__esModule` は無視する
      if (
        t.isIdentifier(nodeLeft.property) &&
        nodeLeft.property.name === `__esModule`
      ) {
        return
      }

      // `exports.foo = bar` から foo を取得する
      if (
        t.isIdentifier(nodeLeft.object) &&
        nodeLeft.object.name === `exports`
      ) {
        isCommonJS = true
        exportNames.push((nodeLeft.property as t.Identifier).name)
      }

      // `module.exports.foo = bar` から foo を取得する
      if (t.isMemberExpression(nodeLeft.object)) {
        const exp: t.MemberExpression = nodeLeft.object

        if (
          t.isIdentifier(exp.object) &&
          t.isIdentifier(exp.property) &&
          exp.object.name === `module` &&
          exp.property.name === `exports`
        ) {
          isCommonJS = true
          exportNames.push((nodeLeft.property as t.Identifier).name)
        }
      }
    },
  })

  if (isES6 && isCommonJS && process.env.NODE_ENV !== `test`) {
    report.panic(
      `This plugin file is using both CommonJS and ES6 module systems together which we don't support.
You'll need to edit the file to use just one or the other.

plugin: ${modulePath}.js

This didn't cause a problem in Gatsby v1 so you might want to review the migration doc for this:
https://gatsby.dev/no-mixed-modules
      `
    )
  }
  return exportNames
}

interface IResolveModuleExportsOptions {
  mode?: `analysis` | `import`
  resolver?: ModuleResolver
  rootDir?: string
}

/**
 * モジュールへのパスを受け取り、そのモジュールの export の配列を返す。
 *
 * 2 つのモードで実行できる:
 * 1. `analysis` モードは、babel でファイルの AST を走査する静的解析によって export を取得する
 * 2. `import` モードは、モジュールを直接 import し、そのプロパティにアクセスして export を取得する
 *
 * 執筆時点では、analysis モードは jsx になりうるファイル（gatsby-browser、gatsby-ssr など）に使い、
 * import モードは js または mjs になりうるファイルに使う。
 *
 * 無効なパスや export のないモジュールに対しては [] を返す。
 */
export async function resolveModuleExports(
  modulePath: string,
  {
    mode = `analysis`,
    resolver = resolveModule,
    rootDir = process.cwd(),
  }: IResolveModuleExportsOptions = {}
): Promise<Array<string>> {
  if (mode === `import`) {
    try {
      const moduleFilePath = await resolveJSFilepath({
        rootDir,
        filePath: modulePath,
      })

      if (!moduleFilePath) {
        return []
      }

      const rawImportedModule = await import(
        maybeAddFileProtocol(moduleFilePath)
      )

      // モジュールが cjs の場合、必要なプロパティはトップレベルの `default` プロパティの下にネストされている
      const importedModule = preferDefault(rawImportedModule)

      return Object.keys(importedModule).filter(
        exportName => exportName !== `__esModule`
      )
    } catch (error) {
      if (!testImportError(modulePath, error)) {
        // モジュールは存在するが require するとエラーになる場合は、
        // ユーザーにエラーを表示してビルドを終了する
        report.panic(`Error in "${modulePath}":`, error)
      }
    }
  } else {
    return staticallyAnalyzeExports(modulePath, resolver)
  }

  return []
}
