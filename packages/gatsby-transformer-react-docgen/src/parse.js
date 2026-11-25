import { handlers, parse, resolver } from "react-docgen"
import { ERROR_MISSING_DEFINITION } from "react-docgen/dist/parse"
import { codeFrameColumns } from "@babel/code-frame"
import { createDisplayNameHandler } from "./displayname-handler"
import { applyPropDoclets, cleanDoclets, parseDoclets } from "./doclets"

const defaultHandlers = [
  handlers.propTypeHandler,
  handlers.propTypeCompositionHandler,
  handlers.propDocBlockHandler,
  handlers.flowTypeHandler,
  handlers.defaultPropsHandler,
  handlers.componentDocblockHandler,
  handlers.componentMethodsHandler,
  handlers.componentMethodsJsDocHandler,
]

let fileCount = 0

/**
 * File ノードなどの追加の引数を渡せるよう、ハンドラーを包む
 */
function makeHandlers(node, handlers) {
  handlers = (handlers || []).map(
    h =>
      (...args) =>
        h(...args, node)
  )
  return [
    createDisplayNameHandler(
      node.absolutePath || `/UnknownComponent${++fileCount}`
    ),
    ...handlers,
  ]
}

export default function parseMetadata(content, node, options) {
  let components = []
  const { handlers, resolver: userResolver, ...parseOptions } = options || {}
  try {
    components = parse(
      content,
      userResolver || resolver.findAllComponentDefinitions,
      makeHandlers(node, handlers).concat(defaultHandlers),
      {
        ...parseOptions,
        filename: node.absolutePath,
      }
    )
  } catch (err) {
    if (err.message === ERROR_MISSING_DEFINITION) return []
    // react-docgen の内部をすべて見せても役に立たないので、スタックをここにリセットする
    // const parseErr = new Error(err.message)
    if (err.loc) {
      err.codeFrame = codeFrameColumns(
        content,
        err.loc.start || {
          start: {
            line: err.loc.line,
            // @babel/code-frame は 8 で列の数え方を 1 始まりから 0 始まりに変え、列を指さないときは
            // null を渡すようになった。表示が変わらないように、これまでの数え方から読み替える
            column: err.loc.column ? err.loc.column - 1 : null,
          },
        },
        {
          highlightCode: true,
        }
      )
    }
    throw err
  }

  if (components.length === 1) {
    components[0].displayName = components[0].displayName.replace(/\d+$/, ``)
  }

  components.forEach(component => {
    component.docblock = component.description || ``
    component.doclets = parseDoclets(component)
    component.description = cleanDoclets(component.description)

    component.props = Object.keys(component.props || {}).map(propName => {
      const prop = component.props[propName]
      prop.name = propName
      prop.docblock = prop.description || ``
      prop.doclets = parseDoclets(prop, propName)
      prop.description = cleanDoclets(prop.description)

      applyPropDoclets(prop)
      return prop
    })
  })

  return components
}
