/* eslint-disable no-unused-expressions */
/*  eslint-disable new-cap */
import graphql from "gatsby/graphql"
import nodePath from "path"
import { NodePath, PluginObj } from "@babel/core"
import { slash } from "gatsby-core-utils/path"
import { murmurhash } from "gatsby-core-utils/murmurhash"
import { Binding } from "babel__traverse"
import {
  CallExpression,
  TaggedTemplateExpression,
  TemplateElement,
  JSXIdentifier,
  JSXAttribute,
  JSXElement,
  JSXOpeningElement,
  Program,
  Identifier,
  StringLiteral,
  ImportDeclaration,
  ObjectExpression,
  VariableDeclarator,
  SourceLocation,
  Expression,
  ExportNamedDeclaration,
  isFunctionDeclaration,
  isVariableDeclaration,
  isFunction,
  isIdentifier,
} from "@babel/types"

interface ISourcePosition {
  line: number
  column: number
}

interface IGraphQLTag {
  ast: any
  text: string
  hash: number
  isGlobal: boolean
}

interface INestedJSXVisitor {
  JSXIdentifier: (path: NodePath<JSXIdentifier>) => void
  queryHash: string
  query: string
}

interface INestedHookVisitor {
  CallExpression: (path: NodePath<CallExpression>) => void
  queryHash: string
  query: string
  templatePaath: NodePath<TaggedTemplateExpression>
}

class StringInterpolationNotAllowedError extends Error {
  interpolationStart: ISourcePosition | undefined
  interpolationEnd: ISourcePosition | undefined

  constructor(
    interpolationStart: ISourcePosition | undefined,
    interpolationEnd: ISourcePosition | undefined
  ) {
    super(
      `BabelPluginRemoveGraphQLQueries: String interpolations are not allowed in graphql ` +
        `fragments. Included fragments should be referenced ` +
        `as \`...MyModule_foo\`.`
    )
    this.interpolationStart = JSON.parse(JSON.stringify(interpolationStart))
    this.interpolationEnd = JSON.parse(JSON.stringify(interpolationEnd))
    Error.captureStackTrace(this, StringInterpolationNotAllowedError)
  }
}

class EmptyGraphQLTagError extends Error {
  templateLoc: SourceLocation | null

  constructor(locationOfGraphqlString: SourceLocation | null) {
    super(`BabelPluginRemoveGraphQLQueries: Unexpected empty graphql tag.`)
    this.templateLoc = locationOfGraphqlString
    Error.captureStackTrace(this, EmptyGraphQLTagError)
  }
}

class GraphQLSyntaxError extends Error {
  documentText: string
  originalError: Error
  templateLoc: SourceLocation | null

  constructor(
    documentText: string,
    originalError: Error,
    locationOfGraphqlString: SourceLocation | null
  ) {
    super(
      `BabelPluginRemoveGraphQLQueries: GraphQL syntax error in query:\n\n${documentText}\n\nmessage:\n\n${originalError}`
    )
    this.documentText = documentText
    this.originalError = originalError
    this.templateLoc = locationOfGraphqlString
    Error.captureStackTrace(this, GraphQLSyntaxError)
  }
}

class ExportIsNotAsyncError extends Error {
  exportStart: ISourcePosition | undefined
  exportName: string

  constructor(exportName: string, exportStart: ISourcePosition | undefined) {
    super(
      `BabelPluginRemoveGraphQLQueries: the "${exportName}" export must be async when using it with graphql`
    )
    this.exportName = exportName
    this.exportStart = JSON.parse(JSON.stringify(exportStart))
    Error.captureStackTrace(this, ExportIsNotAsyncError)
  }
}

const isGlobalIdentifier = (
  tag: NodePath,
  tagName: string = `graphql`
): boolean =>
  tag.isIdentifier({ name: tagName }) && tag.scope.hasGlobal(tagName)

export function followVariableDeclarations(binding: Binding): Binding {
  const node = binding?.path?.node
  if (
    node?.type === `VariableDeclarator` &&
    node?.id.type === `Identifier` &&
    node?.init?.type === `Identifier`
  ) {
    return followVariableDeclarations(
      binding.path.scope.getBinding(node.init.name) as Binding
    )
  }
  return binding
}

function getTagImport(tag: NodePath<Identifier>): NodePath | null {
  const name = tag.node.name
  const binding = tag.scope.getBinding(name)

  if (!binding) return null

  const path = binding.path
  const parent = path.parentPath

  if (
    parent &&
    binding.kind === `module` &&
    parent.isImportDeclaration() &&
    parent.node.source.value === `gatsby`
  )
    return path

  if (
    path.isVariableDeclarator() &&
    (path.get(`init`) as NodePath).isCallExpression() &&
    (path.get(`init.callee`) as NodePath).isIdentifier({ name: `require` }) &&
    (
      (path.get(`init`) as NodePath<CallExpression>).node
        .arguments[0] as StringLiteral
    ).value === `gatsby`
  ) {
    const id = path.get(`id`) as NodePath
    if (id.isObjectPattern()) {
      return id
        .get(`properties`)
        .find(
          path => (path.get(`value`) as NodePath<Identifier>).node.name === name
        ) as NodePath
    }
    return id
  }
  return null
}

function isGraphqlTag(tag: NodePath, tagName: string = `graphql`): boolean {
  const isExpression = tag.isMemberExpression()
  const identifier = isExpression ? tag.get(`object`) : tag

  const importPath = getTagImport(identifier as NodePath<Identifier>)
  if (!importPath) return isGlobalIdentifier(tag, tagName)

  if (
    isExpression &&
    (importPath.isImportNamespaceSpecifier() || importPath.isIdentifier())
  ) {
    return (tag.get(`property`) as NodePath<Identifier>).node.name === tagName
  }

  if (importPath.isImportSpecifier()) {
    if (importPath.node.imported.type === `Identifier`) {
      return importPath.node.imported.name === tagName
    }
    return false
  }

  if (importPath.isObjectProperty())
    return (importPath.get(`key`) as NodePath<Identifier>).node.name === tagName

  return false
}

function removeImport(tag: NodePath<Expression>): void {
  const isExpression = tag.isMemberExpression()
  const identifier = isExpression ? tag.get(`object`) : tag
  const importPath = getTagImport(identifier as NodePath<Identifier>)

  const removeVariableDeclaration = (statement: NodePath): void => {
    const declaration = statement.findParent((p: NodePath) =>
      p.isVariableDeclaration()
    )
    if (declaration) {
      declaration.remove()
    }
  }

  if (!importPath) return

  const parent = importPath.parentPath

  if (importPath.isImportSpecifier()) {
    if (
      parent &&
      (parent as NodePath<ImportDeclaration>).node.specifiers.length === 1
    ) {
      parent.remove()
    } else {
      importPath.remove()
    }
  }
  if (importPath.isObjectProperty()) {
    if ((parent as NodePath<ObjectExpression>).node.properties.length === 1) {
      removeVariableDeclaration(importPath)
    } else importPath.remove()
  }
  if (importPath.isIdentifier()) {
    removeVariableDeclaration(importPath)
  }
}

function getGraphQLTag(
  path: NodePath<TaggedTemplateExpression>,
  tagName: string = `graphql`
): IGraphQLTag {
  const tag: NodePath = path.get(`tag`) as NodePath
  const isGlobal: boolean = isGlobalIdentifier(tag, tagName)

  if (!isGlobal && !isGraphqlTag(tag, tagName)) return {} as IGraphQLTag

  const quasis: Array<TemplateElement> = path.node.quasi.quasis

  if (quasis.length !== 1) {
    throw new StringInterpolationNotAllowedError(
      quasis[0].loc?.end,
      quasis[1].loc?.start
    )
  }

  const text: string = quasis[0].value.raw
  const normalizedText: string = graphql.stripIgnoredCharacters(text)

  const hash: number = murmurhash(normalizedText, 0)
  const location = quasis[0].loc as SourceLocation | null

  try {
    const ast = graphql.parse(text)

    if (ast.definitions.length === 0) {
      throw new EmptyGraphQLTagError(location)
    }
    return { ast, text: normalizedText, hash, isGlobal }
  } catch (err) {
    throw new GraphQLSyntaxError(text, err, location)
  }
}

function isUseStaticQuery(path: NodePath<CallExpression>): boolean {
  const callee = path.node.callee
  if (callee.type === `MemberExpression`) {
    const property = callee.property as Identifier
    if (property.name === `useStaticQuery`) {
      return (path.get(`callee`).get(`object`) as NodePath).referencesImport(
        `gatsby`,
        ``
      )
    }
    return false
  }
  if ((callee as Identifier).name === `useStaticQuery`) {
    return path.get(`callee`).referencesImport(`gatsby`, ``)
  }
  return false
}

export default function ({ types: t }): PluginObj {
  return {
    visitor: {
      Program(path: NodePath<Program>, state: any): void {
        const nestedJSXVistor = {
          JSXIdentifier(path2: NodePath<JSXIdentifier>): void {
            if (
              (process.env.NODE_ENV === `test` ||
                // Storybook の実行中は、クエリを処理する必要がある
                process.env.npm_lifecycle_script?.includes(`storybook`) ||
                state.opts.stage === `develop-html`) &&
              path2.isJSXIdentifier({ name: `StaticQuery` }) &&
              path2.referencesImport(`gatsby`, ``) &&
              path2.parent.type !== `JSXClosingElement`
            ) {
              const identifier = t.identifier(`staticQueryData`)
              const filename = state.file.opts.filename
              const staticQueryDir =
                state.opts.staticQueryDir || `page-data/sq/d`
              const shortResultPath = `public/${staticQueryDir}/${this.queryHash}.json`
              const resultPath = nodePath.join(process.cwd(), shortResultPath)
              // クエリを追加する
              const parent = path2.parent as JSXOpeningElement
              parent.attributes.push(
                t.jSXAttribute(
                  t.jSXIdentifier(`data`),
                  t.jSXExpressionContainer(identifier)
                )
              )
              // import を追加する
              const importDefaultSpecifier =
                t.importDefaultSpecifier(identifier)
              const importDeclaration = t.importDeclaration(
                [importDefaultSpecifier],
                t.stringLiteral(
                  slash(
                    filename
                      ? nodePath.relative(
                          nodePath.dirname(filename),
                          resultPath
                        )
                      : shortResultPath
                  )
                )
              )
              path.node.body.unshift(importDeclaration)
            }
          },
        } as INestedJSXVisitor

        const nestedHookVisitor = {
          CallExpression(path2: NodePath<CallExpression>): void {
            if (
              (process.env.NODE_ENV === `test` ||
                state.opts.stage === `develop-html`) &&
              isUseStaticQuery(path2)
            ) {
              const identifier = t.identifier(`staticQueryData`)
              const filename = state.file.opts.filename
              const staticQueryDir = state.opts.staticQueryDir || `static/d`
              const shortResultPath = `public/${staticQueryDir}/${this.queryHash}.json`
              const resultPath = nodePath.join(process.cwd(), shortResultPath)

              // import を削除するのは、次のような場合だけである:
              // import { useStaticQuery } from 'gatsby'
              // 次のような場合は削除しない:
              // import * as Gatsby from 'gatsby'
              // useStaticQuery の import は削除できると分かっているが、
              // 'gatsby' のほかの export が使われているかどうかは分からないので、
              // 'gatsby' の import をすべて削除することはできない。
              if (path2.node.callee.type !== `MemberExpression`) {
                // useStaticQuery の import を削除する
                const importPath = (
                  path2.scope.getBinding(`useStaticQuery`) as Binding
                ).path
                const parent = importPath.parentPath
                if (importPath.isImportSpecifier())
                  if (
                    parent &&
                    (parent as NodePath<ImportDeclaration>).node.specifiers
                      .length === 1
                  ) {
                    parent.remove()
                  } else {
                    importPath.remove()
                  }
              }

              // クエリを追加する
              path2.replaceWith(
                t.memberExpression(identifier, t.identifier(`data`))
              )

              // import を追加する
              const importDefaultSpecifier =
                t.importDefaultSpecifier(identifier)
              const importDeclaration = t.importDeclaration(
                [importDefaultSpecifier],
                t.stringLiteral(
                  slash(
                    filename
                      ? nodePath.relative(
                          nodePath.dirname(filename),
                          resultPath
                        )
                      : shortResultPath
                  )
                )
              )
              path.node.body.unshift(importDeclaration)
            }
          },
        } as INestedHookVisitor

        const tagsToRemoveImportsFrom = new Set<NodePath<Expression>>()

        const setImportForStaticQuery = (
          templatePath: NodePath<TaggedTemplateExpression>
        ): null => {
          const { ast, text, hash, isGlobal } = getGraphQLTag(templatePath)

          if (!ast) return null

          const queryHash = hash.toString()
          const query = text

          const tag = templatePath.get(`tag`)
          if (!isGlobal) {
            // import の削除をキューに入れる。ここで削除してしまうと、後続の名前付き export が
            // 正しく処理されなくなる
            tagsToRemoveImportsFrom.add(tag)
          }

          // クエリをクエリのハッシュに置き換える。
          templatePath.replaceWith(t.StringLiteral(queryHash))

          // トップレベルの JSXOpeningElement か Program が見つかるまで上へたどる
          // これで、export されたクエリと変数に入ったクエリを処理できる
          let parent: null | NodePath = templatePath as NodePath
          while (
            parent &&
            ![`Program`, `JSXOpeningElement`].includes(parent.node.type)
          ) {
            parent = parent.parentPath
          }

          // クエリが StaticQuery の中にある場合だけ、StaticQuery 要素を書き換えてデータを import する
          if (parent) {
            parent.traverse(nestedJSXVistor, {
              queryHash,
              query,
            })

            // クエリが useStaticQuery の中にある場合だけ、useStaticQuery 要素を書き換えてデータを import する
            parent.traverse(nestedHookVisitor, {
              queryHash,
              query,
              templatePath,
            })
          }

          return null
        }

        // <StaticQuery/> のインスタンスを探して走査する
        path.traverse({
          JSXElement(jsxElementPath: NodePath<JSXElement>) {
            const jsxIdentifier = jsxElementPath.node.openingElement
              .name as JSXIdentifier
            if (jsxIdentifier.name !== `StaticQuery`) {
              return
            }

            jsxElementPath.traverse({
              JSXAttribute(jsxPath: NodePath<JSXAttribute>) {
                if (jsxPath.node.name.name !== `query`) {
                  return
                }
                jsxPath.traverse({
                  TaggedTemplateExpression(
                    templatePath: NodePath<TaggedTemplateExpression>
                  ) {
                    setImportForStaticQuery(templatePath)
                  },
                  Identifier(identifierPath: NodePath<Identifier>) {
                    if (identifierPath.node.name !== `graphql`) {
                      const varName = identifierPath.node.name
                      path.traverse({
                        VariableDeclarator(
                          varPath: NodePath<VariableDeclarator>
                        ) {
                          if (
                            (varPath.node.id as Identifier).name === varName &&
                            varPath.node.init?.type ===
                              `TaggedTemplateExpression`
                          ) {
                            varPath.traverse({
                              TaggedTemplateExpression(
                                templatePath: NodePath<TaggedTemplateExpression>
                              ) {
                                setImportForStaticQuery(templatePath)
                              },
                            })
                          }
                        },
                      })
                    }
                  },
                })
              },
            })
          },
        })

        // useStaticQuery のインスタンスを探してもう一度走査する
        path.traverse({
          CallExpression(hookPath: NodePath<CallExpression>) {
            if (!isUseStaticQuery(hookPath)) return

            function TaggedTemplateExpression(
              templatePath: NodePath<TaggedTemplateExpression>
            ): void {
              setImportForStaticQuery(templatePath)
            }

            // クエリが変数として渡されているかを調べ、
            // そうであればその変数を探しに行く。
            if (
              hookPath.node.arguments.length === 1 &&
              hookPath.node.arguments[0].type === `Identifier`
            ) {
              const [{ name: varName }] = hookPath.node.arguments

              const binding = hookPath.scope.getBinding(varName)

              if (binding) {
                followVariableDeclarations(binding)?.path?.traverse({
                  TaggedTemplateExpression,
                })
              }
            }

            hookPath.traverse({
              // クエリはコンポーネント内にインラインで書かれているとみなして取り出す。
              TaggedTemplateExpression,
            })
          },
        })

        // StaticQuery 以外のものを削除するためにもう一度実行する
        path.traverse({
          TaggedTemplateExpression(path2: NodePath<TaggedTemplateExpression>) {
            const { ast, hash, isGlobal } = getGraphQLTag(path2)

            if (!ast) return null

            const queryHash = hash.toString()

            // FastRefresh に正しく対応するには、ビルドしたページからページクエリの export を
            // 削除する必要がある。FastRefresh はモジュールの import の親をたどるが、
            // ページクエリはどこからも使われないので、FastRefresh は更新を適用してよいかどうかを
            // 判断できない。
            // ページクエリの export を削除すれば、ページコンポーネントでも FastRefresh が正しく動く
            const potentialExportPath = path2.parentPath?.parentPath?.parentPath
            if (
              path2?.parentPath?.parentPath &&
              potentialExportPath?.isExportNamedDeclaration()
            ) {
              potentialExportPath.replaceWith(path2.parentPath.parentPath)
            }

            const tag = path2.get(`tag`)
            if (!isGlobal) {
              // import の削除をキューに入れる。ここで削除してしまうと、後続の名前付き export が
              // 正しく処理されなくなる
              tagsToRemoveImportsFrom.add(tag)
            }

            // config 関数の中に graphql タグがある場合は、グローバルの呼び出しに置き換える。例:
            //   export async function config() {
            //     const { data } = graphql`{ __typename }`
            //   }
            // これを次のように置き換える:
            //   export async function config() {
            //     const { data } = await global.__gatsbyGraphql(`{ __typename }`)
            //   }
            // Note: "config" の export が async でない場合、isWithinConfigExport は例外を投げる
            if (isWithinConfigExport(path2)) {
              const globalCall = t.awaitExpression(
                t.callExpression(
                  t.memberExpression(
                    t.identifier(`global`),
                    t.identifier(`__gatsbyGraphql`)
                  ),
                  [path2.node.quasi]
                )
              )
              path2.replaceWith(globalCall)
              return null
            }

            path2.replaceWith(t.StringLiteral(queryHash))
            return null
          },
        })
        tagsToRemoveImportsFrom.forEach(removeImport)
      },
    },
  }
}

function isWithinConfigExport(
  path: NodePath<TaggedTemplateExpression>
): boolean {
  const parentExport = path.findParent(parent =>
    parent.isExportNamedDeclaration()
  ) as NodePath<ExportNamedDeclaration> | null

  const declaration = parentExport?.node?.declaration

  if (isFunctionDeclaration(declaration) && declaration.id?.name === `config`) {
    if (!declaration.async) {
      throw new ExportIsNotAsyncError(`config`, declaration.loc?.start)
    }
    return true
  }
  if (
    isVariableDeclaration(declaration) &&
    isIdentifier(declaration.declarations[0]?.id) &&
    declaration.declarations[0]?.id?.name === `config`
  ) {
    const init = declaration.declarations[0]?.init
    if (!isFunction(init) || !init.async) {
      throw new ExportIsNotAsyncError(`config`, init?.loc?.start)
    }
    return true
  }
  return false
}

export {
  getGraphQLTag,
  StringInterpolationNotAllowedError,
  EmptyGraphQLTagError,
  GraphQLSyntaxError,
  ExportIsNotAsyncError,
  isWithinConfigExport,
}
