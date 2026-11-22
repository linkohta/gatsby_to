import {
  ITEM_PROP_WORKAROUND_KEY,
  ITEM_PROP_WORKAROUND_VALUE,
  HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY,
  VALID_NODE_NAMES,
} from "./constants"

/**
 * ページから渡された props を、head に関係するものだけに絞り込む。
 * たとえば、SSR 中に undefined になるプロパティを取り除く。
 */
export function filterHeadProps(input) {
  return {
    location: {
      pathname: input.location.pathname,
    },
    params: input.params,
    data: input.data || {},
    serverData: input.serverData,
    pageContext: input.pageContext,
  }
}

/**
 * Head の export が有効な関数でない場合はエラーを投げる
 */
export function headExportValidator(head) {
  if (typeof head !== `function`)
    throw new Error(
      `Expected "Head" export to be a function got "${typeof head}".`
    )
}

/**
 * 同じメッセージの警告は 1 回だけ出す
 */
let warnOnce = _ => {}
if (process.env.NODE_ENV !== `production`) {
  const warnings = new Set()
  warnOnce = msg => {
    if (!warnings.has(msg)) {
      console.warn(msg)
    }
    warnings.add(msg)
  }
}

/**
 * Head 内の無効なタグについて警告する。直接追加された場合と、`wrapRootElement` によって持ち込まれた場合がある
 * @param {string} tagName
 */
export function warnForInvalidTag(tagName) {
  if (process.env.NODE_ENV !== `production`) {
    const warning = createWarningForInvalidTag(tagName)
    warnOnce(warning)
  }
}

function createWarningForInvalidTag(tagName) {
  return `<${tagName}> is not a valid head element. Please use one of the following: ${VALID_NODE_NAMES.join(
    `, `
  )}.\n\nAlso make sure that wrapRootElement in gatsby-ssr/gatsby-browser doesn't contain UI elements: https://gatsby.dev/invalid-head-elements`
}

/**
 * 要素に `nonce` がある場合、Chrome や Firefox などのブラウザーはセキュリティ上の理由から、
 * *要素がドキュメントに追加された時点で* 実際の HTML 属性から nonce を取り除く。そのため、
 * nonce を持つ等価な 2 つの要素があっても、片方がドキュメントに追加されると
 * `Element,isEqualNode()` は false を返す。`element.nonce` プロパティは両方の要素で
 * 同じだが、ドキュメントに追加されたほうは、nonce の HTML 属性値として
 * 空文字列を返す。
 *
 * そこで、この独自の `isEqualNode()` 関数は、`oldTag` と比較する前に `newTag` から
 * nonce の値を取り除き、比較後に元へ戻す。
 *
 * 詳細は次を参照:
 * https://bugs.chromium.org/p/chromium/issues/detail?id=1211471#c12
 */
export function isEqualNode(oldTag, newTag) {
  if (oldTag instanceof HTMLElement && newTag instanceof HTMLElement) {
    const nonce = newTag.getAttribute(`nonce`)
    // `oldTag` の nonce が取り除かれている場合にだけ nonce を取り除く。nonce を含む Content Security Policy の
    // レスポンスヘッダーがない場合、要素の nonce 属性は取り除かれない。
    if (nonce && !oldTag.getAttribute(`nonce`)) {
      const cloneTag = newTag.cloneNode(true)
      cloneTag.setAttribute(`nonce`, ``)
      cloneTag.nonce = nonce
      return nonce === oldTag.nonce && oldTag.isEqualNode(cloneTag)
    }
  }

  return oldTag.isEqualNode(newTag)
}

export function diffNodes({ oldNodes, newNodes, onStale, onNew }) {
  for (const existingHeadElement of oldNodes) {
    const indexInNewNodes = newNodes.findIndex(e =>
      isEqualNode(e, existingHeadElement)
    )

    if (indexInNewNodes === -1) {
      onStale(existingHeadElement)
    } else {
      // このノードはそのまま再作成されるので、古いノードを残し、新しいノードの一覧から取り除く（ここで処理済みのため）
      newNodes.splice(indexInNewNodes, 1)
    }
  }

  // 残りの新しいノードには一致する古いノードがなかったので、追加する必要がある
  for (const newNode of newNodes) {
    onNew(newNode)
  }
}

export function getValidHeadNodesAndAttributes(
  rootNode,
  htmlAndBodyAttributes = {
    html: {},
    body: {},
  }
) {
  const seenIds = new Map()
  const validHeadNodes = []

  for (const node of rootNode.childNodes) {
    // 要素以外のノードは不要なので、ループの前に取り除く
    if (!isElementType(node)) continue

    const nodeName =
      node.attributes?.getNamedItem(HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY)
        ?.value ?? node.nodeName.toLowerCase()
    const id = node.attributes?.id?.value

    if (isValidNodeName(nodeName)) {
      // <html> と <body> のタグは扱いが異なる。レンダリングはせず、属性だけを取り出して別途適用する
      if (nodeName === `html` || nodeName === `body`) {
        for (const attribute of node.attributes) {
          if (attribute.name === HTML_BODY_ORIGINAL_TAG_ATTRIBUTE_KEY) continue

          const isStyleAttribute = attribute.name === `style`

          // 前回のループで処理した同じ nodeName の属性をマージする
          htmlAndBodyAttributes[nodeName] = {
            ...htmlAndBodyAttributes[nodeName],
          }

          if (!isStyleAttribute) {
            htmlAndBodyAttributes[nodeName][attribute.name] = attribute.value
          }

          // すでに style 属性がある場合はマージする必要がある。そうしないと最後のものが「勝って」しまう
          if (isStyleAttribute) {
            htmlAndBodyAttributes[nodeName].style = `${
              htmlAndBodyAttributes[nodeName]?.style
                ? htmlAndBodyAttributes[nodeName].style
                : ``
            }${attribute.value} `
          }
        }
      } else {
        let clonedNode = node.cloneNode(true)
        clonedNode.setAttribute(`data-gatsby-head`, true)

        if (
          clonedNode.getAttribute(ITEM_PROP_WORKAROUND_KEY) ===
          ITEM_PROP_WORKAROUND_VALUE
        ) {
          clonedNode.removeAttribute(ITEM_PROP_WORKAROUND_KEY)
        }

        // script タグを動作させるためのハック
        // TODO(serhalp): これが何を解決しているのか説明する
        if (clonedNode.nodeName.toLowerCase() === `script`) {
          clonedNode = cloneNodeWithoutNS(clonedNode)
        }
        // head 内で id の重複は許されないので、重複を取り除く必要がある
        if (id) {
          if (!seenIds.has(id)) {
            validHeadNodes.push(clonedNode)
            seenIds.set(id, validHeadNodes.length - 1)
          } else {
            const indexOfPreviouslyInsertedNode = seenIds.get(id)
            validHeadNodes[
              indexOfPreviouslyInsertedNode
            ].parentNode?.removeChild(
              validHeadNodes[indexOfPreviouslyInsertedNode]
            )
            validHeadNodes[indexOfPreviouslyInsertedNode] = clonedNode
          }
        } else {
          validHeadNodes.push(clonedNode)
        }
      }
    } else {
      warnForInvalidTag(nodeName)
    }

    if (node.childNodes.length) {
      validHeadNodes.push(
        ...getValidHeadNodesAndAttributes(node, htmlAndBodyAttributes)
          .validHeadNodes
      )
    }
  }

  return { validHeadNodes, htmlAndBodyAttributes }
}

/**
 * HTML 名前空間で要素を再作成する。
 *
 * `cloneNode()` に似ているが、名前空間のような変更不可のプロパティを初期化し直す。
 */
function cloneNodeWithoutNS(node) {
  const clonedNode = document.createElement(node.nodeName)
  for (const attr of node.attributes) {
    clonedNode.setAttribute(attr.name, attr.value)
  }
  clonedNode.innerHTML = node.innerHTML

  return clonedNode
}

export function isValidNodeName(nodeName) {
  return VALID_NODE_NAMES.includes(nodeName)
}
/*
 * Head では要素ノード（type = 1）だけが対象なので、このユーティリティで要素以外のノードを読み飛ばす
 * ノードの種類については https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType を参照
 */
export function isElementType(node) {
  return node.nodeType === 1
}

/**
 * `Head` が追加した head の要素をすべて削除する
 */
export function removePrevHeadElements() {
  const prevHeadNodes = document.querySelectorAll(`[data-gatsby-head]`)
  for (const node of prevHeadNodes) {
    node.parentNode.removeChild(node)
  }
}

export function applyHtmlAndBodyAttributes(htmlAndBodyAttributes) {
  if (!htmlAndBodyAttributes) return

  const { html, body } = htmlAndBodyAttributes

  const htmlElement = document.querySelector(`html`)
  if (htmlElement) {
    Object.entries(html).forEach(([attributeName, attributeValue]) => {
      htmlElement.setAttribute(attributeName, attributeValue)
    })
  }

  const bodyElement = document.querySelector(`body`)
  if (bodyElement) {
    Object.entries(body).forEach(([attributeName, attributeValue]) => {
      bodyElement.setAttribute(attributeName, attributeValue)
    })
  }
}

export function removeHtmlAndBodyAttributes(htmlAndBodyattributeList) {
  if (!htmlAndBodyattributeList) return

  const { html, body } = htmlAndBodyattributeList

  if (html) {
    const htmlElement = document.querySelector(`html`)
    html.forEach(attributeName => {
      if (htmlElement) {
        htmlElement.removeAttribute(attributeName)
      }
    })
  }

  if (body) {
    const bodyElement = document.querySelector(`body`)
    body.forEach(attributeName => {
      if (bodyElement) {
        bodyElement.removeAttribute(attributeName)
      }
    })
  }
}
