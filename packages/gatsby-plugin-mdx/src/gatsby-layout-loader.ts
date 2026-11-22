/* eslint-disable @babel/no-invalid-this */
import path from "path"
import type { NodePluginArgs } from "gatsby"
import { slash } from "gatsby-core-utils/path"
import { getPathToContentComponent } from "gatsby-core-utils/parse-component-path"
import type {
  Program,
  Declaration,
  Expression,
  ExportDefaultDeclaration,
  Identifier,
  FunctionDeclaration,
} from "estree"
import type { LoaderDefinition } from "webpack"
import type { IMdxPluginOptions } from "./plugin-options"
import { ERROR_CODES } from "./error-utils"
import { cachedImport } from "./cache-helpers"

export interface IGatsbyLayoutLoaderOptions {
  options: IMdxPluginOptions
  nodeExists: (path: string) => Promise<boolean>
  reporter: NodePluginArgs["reporter"]
}

// MDX のコンテンツを Gatsby の Layout コンポーネントで包む
const gatsbyLayoutLoader: LoaderDefinition = async function (
  source
): Promise<string | Buffer> {
  const { nodeExists, reporter } =
    this.getOptions() as IGatsbyLayoutLoaderOptions
  // MDX ファイルのパスがリソースクエリのパラメーターとして渡されたのか、
  // MDX ファイルがパスとして直接読み込まれたのかを判別する。
  const mdxPath = getPathToContentComponent(
    `${this.resourcePath}${this.resourceQuery}`
  )

  if (!(await nodeExists(mdxPath))) {
    reporter.panicOnBuild({
      id: ERROR_CODES.NonExistentFileNode,
      context: {
        resourcePath: this.resourcePath,
        mdxPath,
      },
    })
  }

  // mdx を webpack の依存に追加する
  this.addDependency(path.resolve(mdxPath))

  const acorn = await cachedImport<typeof import("acorn")>(`acorn`)
  // @ts-ignore - We typecast below
  const { default: jsx } = await cachedImport(`acorn-jsx`)
  const { generate } = await cachedImport<typeof import("astring")>(`astring`)
  const { buildJsx } = await cachedImport<
    typeof import("estree-util-build-jsx")
  >(`estree-util-build-jsx`)

  const JSX = jsx as typeof import("acorn-jsx")

  try {
    const tree = acorn.Parser.extend(JSX()).parse(source, {
      ecmaVersion: `latest`,
      sourceType: `module`,
      locations: true,
    })

    const AST = tree as unknown as Program

    // ツリーが Program でない場合は throw する
    if (!AST.body && !AST.sourceType) {
      reporter.panicOnBuild({
        id: ERROR_CODES.InvalidAcornAST,
        context: {
          resourcePath: this.resourcePath,
          mdxPath,
        },
      })
    }

    /**
     * ファイルの先頭に、実際の MDX ファイルの import を注入する
     * 入力:
     * [なし]
     * 出力:
     * import GATSBY_COMPILED_MDX from "/absolute/path/to/content.mdx"
     */
    AST.body.unshift({
      type: `ImportDeclaration`,
      specifiers: [
        {
          type: `ImportDefaultSpecifier`,
          local: {
            type: `Identifier`,
            name: `GATSBY_COMPILED_MDX`,
          },
        },
      ],
      source: {
        type: `Literal`,
        value: slash(mdxPath),
      },
      attributes: [],
    })

    let hasClassicReactImport = false

    /**
     * デフォルトエクスポートを、コンパイル済みの MDX を children として注入するラッパー関数に置き換える
     * 入力:
     * export default PageTemplate
     * 出力:
     * export default (props) => <PageTemplate {...props}>{GATSBY_COMPILED_MDX}</PageTemplate>
     **/
    const newBody: Array<any> = []
    AST.body.forEach(child => {
      if (
        child.type === `ImportDeclaration` &&
        child.source.value === `react`
      ) {
        hasClassicReactImport = true
      }

      if (child.type !== `ExportDefaultDeclaration`) {
        newBody.push(child)
        return
      }

      const declaration = child.declaration as Declaration | Expression
      const pageComponentName =
        (declaration as FunctionDeclaration).id?.name ||
        (declaration as Identifier).name ||
        null

      if (!pageComponentName) {
        reporter.panicOnBuild({
          id: ERROR_CODES.NonDeterminableExportName,
          context: {
            resourcePath: this.resourcePath,
          },
        })
      }

      newBody.push(declaration)

      newBody.push({
        type: `ExportDefaultDeclaration`,
        declaration: {
          type: `FunctionDeclaration`,
          id: {
            type: `Identifier`,
            name: `GatsbyMDXWrapper`,
          },
          expression: false,
          generator: false,
          async: false,
          params: [
            {
              type: `Identifier`,
              name: `props`,
            },
          ],
          body: {
            type: `BlockStatement`,
            body: [
              {
                type: `ReturnStatement`,
                argument: {
                  type: `JSXElement`,
                  openingElement: {
                    type: `JSXOpeningElement`,
                    attributes: [
                      {
                        type: `JSXSpreadAttribute`,
                        argument: {
                          type: `Identifier`,
                          name: `props`,
                        },
                      },
                    ],
                    name: {
                      type: `JSXIdentifier`,
                      name: pageComponentName,
                    },
                    selfClosing: false,
                  },
                  closingElement: {
                    type: `JSXClosingElement`,
                    name: {
                      type: `JSXIdentifier`,
                      name: pageComponentName,
                    },
                  },
                  children: [
                    {
                      type: `JSXElement`,
                      openingElement: {
                        type: `JSXOpeningElement`,
                        attributes: [
                          {
                            type: `JSXSpreadAttribute`,
                            argument: {
                              type: `Identifier`,
                              name: `props`,
                            },
                          },
                        ],
                        name: {
                          type: `JSXIdentifier`,
                          name: `GATSBY_COMPILED_MDX`,
                        },
                        selfClosing: true,
                      },
                      children: [],
                    },
                  ],
                },
              },
            ],
          },
        },
      } as unknown as ExportDefaultDeclaration)
    })

    if (!hasClassicReactImport) {
      newBody.unshift({
        type: `ImportDeclaration`,
        specifiers: [
          {
            type: `ImportDefaultSpecifier`,
            local: {
              type: `Identifier`,
              name: `React`,
            },
          },
        ],
        source: {
          type: `Literal`,
          value: `react`,
        },
      })
    }

    AST.body = newBody

    buildJsx(AST)

    const transformedSource = generate(AST)

    return transformedSource
  } catch (error) {
    reporter.panicOnBuild({
      id: ERROR_CODES.InvalidAcornAST,
      context: {
        resourcePath: this.resourcePath,
        mdxPath,
      },
      error,
    })
    return ``
  }
}

export default gatsbyLayoutLoader
