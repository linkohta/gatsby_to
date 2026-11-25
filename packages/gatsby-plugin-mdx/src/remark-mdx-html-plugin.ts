import { cachedImport } from "./cache-helpers"

import type { Node } from "unist"
import type { Definition, Literal } from "mdast"
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx"

// このプラグインは、html ノードを、dangerouslySetInnerHTML で指定の HTML をレンダリングする JSX の span に置き換える
// これが本当に良い方法かは見極める必要があるが、指定の HTML を走査する他の方法に比べて、
// 処理の負荷はとても小さい。
export const remarkMdxHtmlPlugin = () =>
  async function transformer(markdownAST: Node): Promise<Node> {
    const { visit } =
      await cachedImport<typeof import("unist-util-visit")>(`unist-util-visit`)
    const { toHast } =
      await cachedImport<typeof import("mdast-util-to-hast")>(
        `mdast-util-to-hast`
      )

    // mdast ノードを hast ノードに変換する
    // gatsby-plugin-autolink-headers に対応するために必要である
    visit(markdownAST, node => {
      if (node.data && Object.keys(node.data).includes(`hChildren`)) {
        const converted = toHast(node as Definition, {
          allowDangerousHtml: true,
        })
        if (converted) {
          Object.assign(node, converted)
        }
      }
    })

    // raw ノードと html ノードを、dangerouslySetInnerHTML を使う JSX の span に変換する
    // gatsby-remark-images と gatsby-remark-autolink-headers に対応するために必要である
    visit(markdownAST, node => {
      if (![`html`, `raw`].includes(node.type)) {
        return
      }

      const typedNode = node as MdxJsxFlowElement
      typedNode.type = `mdxJsxFlowElement`
      typedNode.name = `span`
      typedNode.attributes = [
        {
          type: `mdxJsxAttribute`,
          name: `dangerouslySetInnerHTML`,
          value: {
            type: `mdxJsxAttributeValueExpression`,
            data: {
              estree: {
                type: `Program`,
                body: [
                  {
                    type: `ExpressionStatement`,
                    expression: {
                      type: `ObjectExpression`,
                      properties: [
                        {
                          type: `Property`,
                          method: false,
                          shorthand: false,
                          computed: false,
                          key: {
                            type: `Identifier`,
                            name: `__html`,
                          },
                          value: {
                            type: `Literal`,
                            value: (node as Literal).value,
                          },
                          kind: `init`,
                        },
                      ],
                    },
                  },
                ],
                sourceType: `module`,
              },
            },
          },
        } as MdxJsxAttribute,
      ]
    })

    return markdownAST
  }
