/* eslint-disable no-unused-expressions */
// @flow
const fs = require(`fs-extra`)
const crypto = require(`crypto`)
const _ = require(`lodash`)
const slugify = require(`slugify`)

// Traverse は es6 モジュールである...
import traverse from "@babel/traverse"
import * as t from "@babel/types"
const {
  getGraphQLTag,
  StringInterpolationNotAllowedError,
  EmptyGraphQLTagError,
  GraphQLSyntaxError,
  ExportIsNotAsyncError,
  isWithinConfigExport,
} = require(`babel-plugin-remove-graphql-queries`)
import { collectSlices } from "../utils/babel/find-slices"

const report = require(`gatsby-cli/lib/reporter`)

import type { DocumentNode } from "graphql"
import { babelParseToAst } from "../utils/babel-parse-to-ast"
import {
  codeFrameColumns,
  fromBabelPosition,
} from "gatsby-core-utils/code-frame"
import { getPathToLayoutComponent, md5 } from "gatsby-core-utils"

const apiRunnerNode = require(`../utils/api-runner-node`)
const { actions } = require(`../redux/actions`)
const { store } = require(`../redux`)
import { locInGraphQlToLocInFile } from "./error-parser"
/**
 * ユーザーが定義していない場合は、自動生成したクエリ名を追加する。
 */
const generateQueryName = ({ def, hash, file, queryType }) => {
  if (!def.name || !def.name.value) {
    const slugified = slugify(file, {
      replacement: ` `,
      lower: false,
    })
    def.name = {
      value: `${_.camelCase(`${queryType}-${slugified}-${hash}`)}`,
      kind: `Name`,
    }
  }
  return def
}

// `babel-plugin-remove-graphql-queries` から持ってきたもの。将来はそちらから
// import する
function followVariableDeclarations(binding) {
  const node = binding?.path?.node
  if (
    node?.type === `VariableDeclarator` &&
    node?.id.type === `Identifier` &&
    node?.init?.type === `Identifier`
  ) {
    return followVariableDeclarations(
      binding.path.scope.getBinding(node.init.name)
    )
  }
  return binding
}

function referencesGatsby(path, callee, calleeName) {
  // これは es6 の import で動く
  if (callee.referencesImport(`gatsby`, ``)) {
    return true
  } else {
    // userStaticQuery が宣言された場所を探し、それが "require" であり、
    // 引数が "gatsby" であるかを確認する。
    const declaration = path.scope.getBinding(calleeName)
    if (
      declaration &&
      declaration.path.node.init?.callee.name === `require` &&
      declaration.path.node.init.arguments[0].value === `gatsby`
    ) {
      return true
    } else {
      return false
    }
  }
}

function isUseStaticQuery(path) {
  const callee = path.node.callee
  if (callee.type === `MemberExpression`) {
    const property = callee.property
    if (property.name === `useStaticQuery`) {
      return referencesGatsby(
        path,
        path.get(`callee`).get(`object`),
        path.node?.callee.object.name
      )
    }
    return false
  }
  if (callee.name === `useStaticQuery`) {
    return referencesGatsby(path, path.get(`callee`), path.node?.callee.name)
  }
  return false
}

const warnForUnknownQueryVariable = (varName, file, usageFunction) =>
  report.warn(
    `\nWe were unable to find the declaration of variable "${varName}", which you passed as the "query" prop into the ${usageFunction} declaration in "${file}".

Perhaps the variable name has a typo?

Also note that we are currently unable to use queries defined in files other than the file where the ${usageFunction} is defined. If you're attempting to import the query, please move it into "${file}". If being able to import queries from another file is an important capability for you, we invite your help fixing it.\n`
  )

async function parseToAst(filePath, fileStr, { parentSpan, addError } = {}) {
  let ast

  // gatsby-plugin-mdx v4 以降では、webpack のローダーの resourceQuery 機能を使って、コンテンツファイルをページコンポーネントに注入している。
  const cleanFilePath = getPathToLayoutComponent(filePath)

  // ソースを前処理してパースを試みる。できれば AST を返し、
  // できなければエラーをログに出す。
  const transpiled = await apiRunnerNode(`preprocessSource`, {
    filename: cleanFilePath,
    contents: fileStr,
    parentSpan,
  })

  if (transpiled && transpiled.length) {
    for (const item of transpiled) {
      try {
        const tmp = babelParseToAst(item, cleanFilePath)
        ast = tmp
        break
      } catch (error) {
        // トランスパイルしたすべてのバリエーションでパースに失敗した場合は、実際のエラーを下で出す
      }
    }
    if (ast === undefined) {
      addError({
        id: `85912`,
        filePath: cleanFilePath,
        context: {
          filePath,
        },
      })
      store.dispatch(
        actions.queryExtractionGraphQLError({
          componentPath: cleanFilePath,
        })
      )

      return null
    }
  } else {
    try {
      ast = babelParseToAst(fileStr, cleanFilePath)
    } catch (error) {
      store.dispatch(
        actions.queryExtractionBabelError({
          componentPath: cleanFilePath,
          error,
        })
      )

      addError({
        id: `85911`,
        filePath: cleanFilePath,
        context: {
          filePath: cleanFilePath,
        },
      })

      return null
    }
  }

  return ast
}

const panicOnGlobalTag = file =>
  report.panicOnBuild(
    `Using the global \`graphql\` tag for Gatsby's queries isn't supported as of v3.\n` +
      `Import it instead like:  import { graphql } from 'gatsby' in file:\n` +
      file
  )

type GraphQLDocumentInFile = {
  filePath: string,
  doc: DocumentNode,
  templateLoc: string,
  text: string,
  hash: string,
  isHook: boolean,
  isStaticQuery: boolean,
}

// gatsby/src/utils/babel/babel-plugin-remove-api を基に改変したもの
function findApiExport(ast, api) {
  let hasExport = false
  const apiToFind = api ?? ``

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration

      if (t.isExportNamedDeclaration(path.node) && !hasExport) {
        hasExport = path.node.specifiers.some(
          specifier =>
            t.isExportSpecifier(specifier) &&
            t.isIdentifier(specifier.exported) &&
            specifier.exported.name === apiToFind
        )
      }

      let apiToCheck
      if (t.isFunctionDeclaration(declaration) && declaration.id) {
        apiToCheck = declaration.id.name
      }

      if (
        t.isVariableDeclaration(declaration) &&
        t.isIdentifier(declaration.declarations[0].id)
      ) {
        apiToCheck = declaration.declarations[0].id.name
      }

      if (apiToCheck && apiToCheck === apiToFind) {
        hasExport = true
      }
    },
  })

  return hasExport
}

async function findGraphQLTags(
  file,
  ast,
  { parentSpan, addError } = {}
): Promise<Array<GraphQLDocumentInFile>> {
  const documents = []
  if (!ast) {
    return documents
  }

  /**
   * graphql ドキュメントから一意な位置へのマップ。
   *
   * graphql ドキュメントの一意な位置は、次の 2 つから成る。
   *
   *  - そのドキュメントを含む graphql テンプレートリテラルの位置
   *  - graphql テンプレートリテラルの中でのドキュメントの位置
   *
   * これは、重複したドキュメントを返さないようにするために使う。
   */
  const documentLocations = new WeakMap()

  const extractStaticQuery = (taggedTemplateExpressPath, isHook = false) => {
    const {
      ast: gqlAst,
      text,
      hash,
      isGlobal,
    } = getGraphQLTag(taggedTemplateExpressPath)
    if (!gqlAst) return

    if (isGlobal) {
      panicOnGlobalTag(file)
      return
    }

    gqlAst.definitions.forEach(def => {
      generateQueryName({
        def,
        hash,
        file,
        queryType: `static`,
      })
    })

    let templateLoc

    taggedTemplateExpressPath.traverse({
      TemplateElement(templateElementPath) {
        templateLoc = templateElementPath.node.loc
      },
    })

    const docInFile = {
      filePath: file,
      doc: gqlAst,
      text: text,
      hash: hash,
      isStaticQuery: true,
      isConfigQuery: false,
      isHook,
      templateLoc,
    }

    documentLocations.set(
      docInFile,
      `${taggedTemplateExpressPath.node.start}-${gqlAst.loc.start}`
    )

    documents.push(docInFile)
  }

  // <StaticQuery /> 要素の中のクエリを探す。
  traverse(ast, {
    JSXElement(path) {
      if (path.node.openingElement.name.name !== `StaticQuery`) {
        return
      }

      // このアルゴリズムを試作したときに私（@kyleamathews）が使った astexplorer.com のリンク
      // https://astexplorer.net/#/gist/ab5d71c0f08f287fbb840bf1dd8b85ff/2f188345d8e5a4152fe7c96f0d52dbcc6e9da466
      path.traverse({
        JSXAttribute(jsxPath) {
          if (jsxPath.node.name.name !== `query`) {
            return
          }
          jsxPath.traverse({
            // クエリがコンポーネントの中にインラインで書かれていると仮定して、それを抽出する。
            TaggedTemplateExpression(templatePath) {
              extractStaticQuery(templatePath)
            },
            // props として渡された変数であるかも確認し、
            // そうであれば、その変数を探しに行く。
            Identifier(identifierPath) {
              if (identifierPath.node.name !== `graphql`) {
                const varName = identifierPath.node.name
                let found = false
                traverse(ast, {
                  VariableDeclarator(varPath) {
                    if (
                      varPath.node.id.name === varName &&
                      varPath.node.init.type === `TaggedTemplateExpression`
                    ) {
                      varPath.traverse({
                        TaggedTemplateExpression(templatePath) {
                          found = true
                          extractStaticQuery(templatePath)
                        },
                      })
                    }
                  },
                })
                if (!found) {
                  warnForUnknownQueryVariable(varName, file, `<StaticQuery>`)
                }
              }
            },
          })
        },
      })
      return
    },
  })

  // useStaticQuery フックの中のクエリを探す。
  traverse(ast, {
    CallExpression(hookPath) {
      if (!isUseStaticQuery(hookPath)) return

      const firstArg = hookPath.get(`arguments`)[0]

      // クエリがコンポーネントの中にインラインで書かれていると仮定して、それを抽出する。
      if (firstArg.isTaggedTemplateExpression()) {
        extractStaticQuery(firstArg, true)
        // props として渡された変数であるかも確認し、
        // そうであれば、その変数を探しに行く。
      } else if (firstArg.isIdentifier()) {
        if (
          firstArg.node.name !== `graphql` &&
          firstArg.node.name !== `useStaticQuery`
        ) {
          const varName = firstArg.node.name
          let found = false
          traverse(ast, {
            VariableDeclarator(varPath) {
              if (
                varPath.node.id.name === varName &&
                varPath.node.init.type === `TaggedTemplateExpression`
              ) {
                varPath.traverse({
                  TaggedTemplateExpression(templatePath) {
                    found = true
                    extractStaticQuery(templatePath, true)
                  },
                })
              }
            },
          })
          if (!found) {
            warnForUnknownQueryVariable(varName, file, `useStaticQuery`)
          }
        }
      }
    },
  })

  function TaggedTemplateExpression(innerPath) {
    const { ast: gqlAst, isGlobal, hash, text } = getGraphQLTag(innerPath)
    if (!gqlAst) return

    if (isGlobal) {
      panicOnGlobalTag(file)
      return
    }

    const isConfigQuery = isWithinConfigExport(innerPath)

    gqlAst.definitions.forEach(def => {
      generateQueryName({
        def,
        hash,
        file,
        queryType: isConfigQuery ? `config` : `page`,
      })
    })

    let templateLoc
    innerPath.traverse({
      TemplateElement(templateElementPath) {
        templateLoc = templateElementPath.node.loc
      },
    })

    const docInFile = {
      filePath: file,
      doc: gqlAst,
      text: text,
      hash: hash,
      isStaticQuery: false,
      isConfigQuery,
      isHook: false,
      templateLoc,
    }

    documentLocations.set(
      docInFile,
      `${innerPath.node.start}-${gqlAst.loc.start}`
    )

    documents.push(docInFile)
  }

  // コンポーネントに StaticQuery がある場合は、そのすべての export を調べ、export された変数をたどって、
  // それが（タグ付きテンプレートリテラルを経由して）この静的クエリに行き着くかを判定する
  traverse(ast, {
    ExportNamedDeclaration(path, state) {
      // 再 export（"export { bar } from 'Bar'" など）のエッジケースはスキップする
      // （クエリについては別の場所で処理している。warnForUnknownQueryVariable の使用箇所を参照）
      if (path.node.source) {
        return
      }
      path.traverse({
        TaggedTemplateExpression,
        ExportSpecifier(path) {
          const binding = followVariableDeclarations(
            path.scope.getBinding(path.node.local.name)
          )
          binding?.path?.traverse({ TaggedTemplateExpression })
        },
      })
    },
  })

  // 重複したクエリを取り除く
  const uniqueQueries = _.uniqBy(documents, q => documentLocations.get(q))

  return uniqueQueries
}

type CollectedSlice = {
  name: string,
  allowEmpty: boolean,
}

const cache = {}

// Babel の AST の位置（列が 0 始まり）を、コードフレーム用の位置（列が 1 始まり）へ読み替える
const toCodeFrameLocation = location => {
  return {
    start: location.start && fromBabelPosition(location.start),
    end: location.end && fromBabelPosition(location.end),
  }
}

export default class FileParser {
  constructor({ parentSpan } = {}) {
    this.parentSpan = parentSpan
  }

  async parseFile(
    file: string,
    addError
  ): Promise<{
    astDefinitions: ?Array<GraphQLDocumentInFile>,
    pageSlices: { [key: string]: CollectedSlice } | null,
  }> {
    let text
    const cleanFilepath = getPathToLayoutComponent(file)
    try {
      text = await fs.readFile(cleanFilepath, `utf8`)
    } catch (err) {
      addError({
        id: `85913`,
        filePath: file,
        context: {
          filePath: file,
        },
        error: err,
      })

      store.dispatch(
        actions.queryExtractionGraphQLError({
          componentPath: file,
        })
      )
      return null
    }

    // 関心のないファイルであれば早めに抜けられるように、簡単な確認をする。
    // 以下の API を含むファイルだけを処理する
    if (
      !text.includes(`graphql`) &&
      !text.includes(`gatsby-plugin-image`) &&
      !text.includes(`getServerData`) &&
      !text.includes(`config`) &&
      !text.includes(`Slice`) &&
      !text.includes(`Head`)
    ) {
      return null
    }

    const hash = await md5(file + text)

    try {
      if (!cache[hash]) {
        const ast = await parseToAst(file, text, {
          parentSpan: this.parentSpan,
          addError,
        })

        cache[hash] = {
          astDefinitions: await findGraphQLTags(file, ast, {
            parentSpan: this.parentSpan,
            addError,
          }),
          serverData: findApiExport(ast, `getServerData`),
          config: findApiExport(ast, `config`),
          Head: findApiExport(ast, `Head`),
          pageSlices: collectSlices(ast, file),
        }
      }
      const { astDefinitions, serverData, config, Head, pageSlices } =
        cache[hash]

      // 注: getServerData が見つからなかった場合でも、このアクションを dispatch すべきである
      // （以前に設定されていたかもしれないので、renderMode を SSR からデフォルトに戻す必要がある）
      store.dispatch({
        type: `SET_COMPONENT_FEATURES`,
        payload: {
          componentPath: file,
          serverData,
          config,
          Head,
        },
      })

      // AST の定義が 1 つでも抽出されたら、成功を報告する。
      // 抽出されなかった場合は、定義が 1 つもないか、graphql の AST を抽出しようとしたときに
      // babel のエラーが起きたことを意味しうる。
      if (astDefinitions.length > 0) {
        store.dispatch(
          actions.queryExtractedBabelSuccess({
            componentPath: file,
          })
        )
      }

      return { astDefinitions, pageSlices }
    } catch (err) {
      // デフォルトのエラー
      let structuredError = {
        id: `85915`,
        context: {
          filePath: file,
        },
      }

      if (err instanceof StringInterpolationNotAllowedError) {
        const location = {
          start: err.interpolationStart,
          end: err.interpolationEnd,
        }
        structuredError = {
          id: `85916`,
          location,
          context: {
            codeFrame: codeFrameColumns(text, toCodeFrameLocation(location), {
              highlightCode: process.env.FORCE_COLOR !== `0`,
            }),
          },
        }
      } else if (err instanceof EmptyGraphQLTagError) {
        const location = err.templateLoc
          ? {
              start: err.templateLoc.start,
              end: err.templateLoc.end,
            }
          : null

        structuredError = {
          id: `85917`,
          location,
          context: {
            codeFrame: location
              ? codeFrameColumns(text, toCodeFrameLocation(location), {
                  highlightCode: process.env.FORCE_COLOR !== `0`,
                })
              : null,
          },
        }
      } else if (err instanceof GraphQLSyntaxError) {
        const location = {
          start: locInGraphQlToLocInFile(
            err.templateLoc,
            err.originalError.locations[0]
          ),
        }

        structuredError = {
          id: `85918`,
          location,
          context: {
            codeFrame: location
              ? codeFrameColumns(text, location, {
                  highlightCode: process.env.FORCE_COLOR !== `0`,
                  message: err.originalError.message,
                })
              : null,
            sourceMessage: err.originalError.message,
          },
        }
      } else if (err instanceof ExportIsNotAsyncError) {
        const location = {
          start: err.exportStart,
          end: err.exportStart,
        }
        structuredError = {
          id: `85929`,
          location,
          context: {
            exportName: err.exportName,
            codeFrame: codeFrameColumns(text, toCodeFrameLocation(location), {
              highlightCode: process.env.FORCE_COLOR !== `0`,
            }),
          },
        }
      }

      addError({
        ...structuredError,
        filePath: file,
      })

      store.dispatch(
        actions.queryExtractionGraphQLError({
          componentPath: file,
        })
      )
      return null
    }
  }

  async parseFiles(
    files: Array<string>,
    addError
  ): Promise<Array<GraphQLDocumentInFile>> {
    const documents = []
    const pageSliceUsage = new Map()

    return Promise.all(
      files.map(file =>
        this.parseFile(file, addError).then(results => {
          if (results) {
            const { astDefinitions, pageSlices } = results
            documents.push(...(astDefinitions || []))
            if (pageSlices) {
              pageSliceUsage.set(file, pageSlices)
            }
          }
        })
      )
    ).then(() => {
      store.dispatch({
        type: `SET_COMPONENTS_USING_PAGE_SLICES`,
        payload: pageSliceUsage,
      })

      return documents
    })
  }
}
