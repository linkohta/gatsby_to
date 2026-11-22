"use client"

import React, { useContext } from "react"
import { ServerSlice } from "./slice/server-slice"
import { InlineSlice } from "./slice/inline-slice"
import { SlicesContext } from "./slice/context"

export function Slice(props) {
  if (process.env.GATSBY_SLICES) {
    // 内部では sliceName を使うので、alias を sliceName に対応付け直す
    const internalProps = {
      ...props,
      sliceName: props.alias,
    }
    delete internalProps.alias
    delete internalProps.__renderedByLocation

    const slicesContext = useContext(SlicesContext)

    // props を検証する
    const propErrors = validateSliceProps(props)
    if (Object.keys(propErrors).length) {
      throw new SlicePropsError(
        slicesContext.renderEnvironment === `browser`,
        internalProps.sliceName,
        propErrors,
        props.__renderedByLocation
      )
    }

    if (slicesContext.renderEnvironment === `server`) {
      return <ServerSlice {...internalProps} />
    } else if (slicesContext.renderEnvironment === `browser`) {
      // ブラウザーでは、コンポーネントをそのままレンダリングする
      return <InlineSlice {...internalProps} />
    } else if (
      slicesContext.renderEnvironment === `engines` ||
      slicesContext.renderEnvironment === `dev-ssr`
    ) {
      // SSR の場合は、コンポーネントをそのままレンダリングする
      return <InlineSlice {...internalProps} />
    } else if (slicesContext.renderEnvironment === `slices`) {
      // ネストしたスライスにはまだ対応していない

      let additionalContextMessage = ``

      // 追加のコンテキスト情報の生成に失敗した場合でも、基本のメッセージは表示したい。
      // 別の分かりにくいエラーメッセージを表示しないようにする
      try {
        additionalContextMessage = `\n\nSlice component "${slicesContext.sliceRoot.name}" (${slicesContext.sliceRoot.componentPath}) tried to render <Slice alias="${props.alias}"/>`
      } catch {
        // 処理する必要はない。生成に失敗した場合は、追加のコンテキストメッセージを省くだけである
      }

      throw new Error(
        `Nested slices are not supported.${additionalContextMessage}\n\nSee https://gatsbyjs.com/docs/reference/built-in-components/gatsby-slice#nested-slices`
      )
    } else {
      throw new Error(
        `Slice context "${slicesContext.renderEnvironment}" is not supported.`
      )
    }
  } else {
    throw new Error(`Slices are disabled.`)
  }
}

class SlicePropsError extends Error {
  constructor(inBrowser, sliceName, propErrors, renderedByLocation) {
    const errors = Object.entries(propErrors)
      .map(
        ([key, value]) =>
          `not serializable "${value}" type passed to "${key}" prop`
      )
      .join(`, `)

    const name = `SlicePropsError`
    let stack = ``
    let message = ``

    if (inBrowser) {
      let fullStack = ``

      // React 19 以降は captureOwnerStack を、React 18 は ReactDebugCurrentFrame.getCurrentStack を使う
      if (React.captureOwnerStack) {
        // React 19 以降の方法
        const ownerStack = React.captureOwnerStack()
        const currentStack = new Error().stack || ``
        fullStack = ownerStack ? `${currentStack}\n${ownerStack}` : currentStack
      } else if (
        React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
          ?.ReactDebugCurrentFrame?.getCurrentStack
      ) {
        // React 18 の方法
        fullStack =
          React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactDebugCurrentFrame.getCurrentStack()
      } else {
        // どちらの API も使えない場合のフォールバック
        fullStack = new Error().stack || ``
      }

      // スタックトレースの最初の行を取り除く
      const stackLines = fullStack.trim().split(`\n`).slice(1)
      if (stackLines.length > 0) {
        stackLines[0] = stackLines[0].trim()
        stack = `\n` + stackLines.join(`\n`)
      }

      message = `Slice "${sliceName}" was passed props that are not serializable (${errors}).`
    } else {
      // ブラウザーの外では追加の情報を取得できないので、出せるものだけを出力する
      message = `${name}: Slice "${sliceName}" was passed props that are not serializable (${errors}).`
      const stackLines = new Error().stack.trim().split(`\n`).slice(2)
      stack = `${message}\n${stackLines.join(`\n`)}`
    }

    super(message)
    this.name = name
    if (stack) {
      this.stack = stack
    } else {
      Error.captureStackTrace(this, SlicePropsError)
    }

    if (renderedByLocation) {
      this.forcedLocation = { ...renderedByLocation, functionName: `Slice` }
    }
  }
}

const validateSliceProps = (
  props,
  errors = {},
  seenObjects = [],
  path = null
) => {
  // すべての props を再帰的に検証する
  for (const [name, value] of Object.entries(props)) {
    if (
      value === undefined ||
      value === null ||
      (!path && name === `children`)
    ) {
      continue
    }

    const propPath = path ? `${path}.${name}` : name

    if (typeof value === `function`) {
      errors[propPath] = typeof value
    } else if (typeof value === `object` && seenObjects.indexOf(value) <= 0) {
      seenObjects.push(value)
      validateSliceProps(value, errors, seenObjects, propPath)
    }
  }

  return errors
}
