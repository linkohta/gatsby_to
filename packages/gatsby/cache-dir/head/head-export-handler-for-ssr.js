const React = require(`react`)
const { grabMatchParams } = require(`../find-path`)
const { StaticQueryContext } = require(`gatsby`)
const {
  headExportValidator,
  filterHeadProps,
  isElementType,
  isValidNodeName,
  warnForInvalidTag,
} = require(`./utils`)
const { ServerLocation, Router } = require(`@gatsbyjs/reach-router`)
const { renderToString } = require(`react-dom/server`)
const { parse } = require(`node-html-parser`)
const styleToOjbect = require(`style-to-object`)

import {
  ITEM_PROP_WORKAROUND_KEY,
  ITEM_PROP_WORKAROUND_VALUE,
  HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY,
} from "./constants"
import { getValidHeadComponentReplacements } from "./components/head-components"
import { apiRunner } from "../api-runner-ssr"

export function applyHtmlAndBodyAttributesSSR(
  htmlAndBodyAttributes,
  { setHtmlAttributes, setBodyAttributes }
) {
  if (!htmlAndBodyAttributes) return

  const { html, body } = htmlAndBodyAttributes

  setHtmlAttributes(html)
  setBodyAttributes(body)
}

export function getValidHeadNodesAndAttributesSSR(
  rootNode,
  htmlAndBodyAttributes = {
    html: {},
    body: {},
  }
) {
  const seenIds = new Map()
  const validHeadNodes = []

  // 要素以外のノードは不要なので、ループの前に取り除く
  for (const node of rootNode.childNodes) {
    const { rawTagName } = node
    const id = node.attributes?.id

    if (!isElementType(node)) continue

    const NodeName =
      node.attributes?.[HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY] ?? rawTagName

    if (isValidNodeName(NodeName)) {
      if (NodeName === `html` || NodeName === `body`) {
        const { style, ...nonStyleAttributes } = node.attributes

        htmlAndBodyAttributes[NodeName] = {
          ...htmlAndBodyAttributes[NodeName],
          ...nonStyleAttributes,
        }

        // 残念ながら renderToString はインラインスタイルを文字列に変換するので、オブジェクトへ戻す必要がある
        if (style) {
          htmlAndBodyAttributes[NodeName].style = {
            ...htmlAndBodyAttributes[NodeName]?.style,
            ...styleToOjbect(style),
          }
        }
      } else {
        let element
        const attributes = { ...node.attributes, "data-gatsby-head": true }

        if (
          attributes[ITEM_PROP_WORKAROUND_KEY] === ITEM_PROP_WORKAROUND_VALUE
        ) {
          delete attributes[ITEM_PROP_WORKAROUND_KEY]
        }

        if (NodeName === `script` || NodeName === `style`) {
          element = (
            <NodeName
              {...attributes}
              dangerouslySetInnerHTML={{
                __html: node.text,
              }}
            />
          )
        } else {
          element =
            node.textContent.length > 0 ? (
              <NodeName {...attributes}>{node.textContent}</NodeName>
            ) : (
              <NodeName {...attributes} />
            )
        }

        if (id) {
          if (!seenIds.has(id)) {
            validHeadNodes.push(element)
            seenIds.set(id, validHeadNodes.length - 1)
          } else {
            const indexOfPreviouslyInsertedNode = seenIds.get(id)
            validHeadNodes[indexOfPreviouslyInsertedNode] = element
          }
        } else {
          validHeadNodes.push(element)
        }
      }
    } else {
      warnForInvalidTag(rawTagName)
    }

    if (node.childNodes.length) {
      validHeadNodes.push(
        ...getValidHeadNodesAndAttributesSSR(node, htmlAndBodyAttributes)
          .validHeadNodes
      )
    }
  }

  return { validHeadNodes, htmlAndBodyAttributes }
}

// このパッチを当てる理由は "head-export-handler-for-browser.js" モジュールの説明を参照
let applyCreateElementPatch = undefined
let revertCreateElementPatch = undefined
let needToRevertCreateElementPatch = false

const reactMajor = parseInt(React.version.split(`.`)[0], 10)
if (reactMajor !== 18) {
  const originalCreateElement = React.createElement
  const validHeadComponentReplacements = getValidHeadComponentReplacements(
    originalCreateElement,
    true
  )

  function patchedCreateElement(type, props, ...rest) {
    const headReplacement = validHeadComponentReplacements.get(type)
    if (headReplacement) {
      type = headReplacement
    }

    return originalCreateElement.call(React, type, props, ...rest)
  }

  applyCreateElementPatch = () => {
    needToRevertCreateElementPatch = true
    React.createElement = patchedCreateElement
  }

  revertCreateElementPatch = () => {
    if (needToRevertCreateElementPatch) {
      React.createElement = originalCreateElement
      needToRevertCreateElementPatch = false
    }
  }
}

// この同期関数を非同期に変更する場合は、React.createElement へのパッチについても必ず対応すること。
// 現在の処理は同期であることに依存しており、レンダリングのコンテキストを確認せずに React.createElement を一時的に変更している
// （解決策の候補は "head-export-handler-for-browser.js" モジュールでの実装を参照）
export function headHandlerForSSR({
  pageComponent,
  setHeadComponents,
  setHtmlAttributes,
  setBodyAttributes,
  staticQueryContext,
  pageData,
  pagePath,
}) {
  if (pageComponent?.Head) {
    try {
      headExportValidator(pageComponent.Head)

      function HeadRouteHandler(props) {
        const _props = {
          ...props,
          ...pageData.result,
          params: {
            ...grabMatchParams(props.location.pathname),
            ...(pageData.result?.pageContext?.__params || {}),
          },
        }

        const HeadElement = <pageComponent.Head {...filterHeadProps(_props)} />

        const headWithWrapRootElement = apiRunner(
          `wrapRootElement`,
          { element: HeadElement },
          HeadElement,
          ({ result }) => {
            return { element: result }
          }
        ).pop()

        return headWithWrapRootElement
      }

      const routerElement = (
        <StaticQueryContext.Provider value={staticQueryContext}>
          <ServerLocation url={`${__BASE_PATH__}${pagePath}`}>
            <Router
              baseuri={__BASE_PATH__}
              component={({ children }) => <>{children}</>}
            >
              <HeadRouteHandler path="/*" />
            </Router>
          </ServerLocation>
        </StaticQueryContext.Provider>
      )

      applyCreateElementPatch?.()

      const rawString = renderToString(routerElement)

      revertCreateElementPatch?.()

      const rootNode = parse(rawString)
      const { validHeadNodes, htmlAndBodyAttributes } =
        getValidHeadNodesAndAttributesSSR(rootNode)

      applyHtmlAndBodyAttributesSSR(htmlAndBodyAttributes, {
        setHtmlAttributes,
        setBodyAttributes,
      })

      setHeadComponents(validHeadNodes)
    } catch (e) {
      // パッチを元に戻さずにこの関数を抜けることがないようにする
      revertCreateElementPatch?.()
      throw e
    }
  }
}
