import React, { useEffect } from "react"
import { collectedScriptsByPage } from "./collected-scripts-by-page"
import type { ReactElement, ScriptHTMLAttributes } from "react"
import { requestIdleCallback } from "./request-idle-callback-shim"
import { Location, useLocation } from "@gatsbyjs/reach-router"

export enum ScriptStrategy {
  postHydrate = `post-hydrate`,
  idle = `idle`,
  offMainThread = `off-main-thread`,
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface ScriptProps
  extends Omit<ScriptHTMLAttributes<HTMLScriptElement>, `onLoad` | `onError`> {
  id?: string
  strategy?: ScriptStrategy | `post-hydrate` | `idle` | `off-main-thread`
  children?: string
  onLoad?: (event: Event) => void
  onError?: (event: ErrorEvent) => void
  forward?: Array<string>
}

const handledProps = new Set([
  `src`,
  `strategy`,
  `dangerouslySetInnerHTML`,
  `children`,
  `onLoad`,
  `onError`,
])

// 重複の排除に使う
export const scriptCache: Set<string> = new Set()
export const scriptCallbackCache: Map<
  string,
  {
    load?: {
      callbacks?: Array<(event: Event) => void>
      event?: Event | undefined
    }
    error?: {
      callbacks?: Array<(event: ErrorEvent) => void>
      event?: ErrorEvent | undefined
    }
  }
> = new Map()

// Gatsby Link でも同じパターンを使っている
function GatsbyScriptLocationWrapper(props: ScriptProps): JSX.Element {
  return <Location>{(): JSX.Element => <GatsbyScript {...props} />}</Location>
}

function GatsbyScript(props: ScriptProps): ReactElement | null {
  const { src, strategy = ScriptStrategy.postHydrate } = props || {}

  const { pathname } = useLocation()

  useEffect(() => {
    let details: IInjectedScriptDetails | null

    switch (strategy) {
      case ScriptStrategy.postHydrate:
        details = injectScript(props)
        break
      case ScriptStrategy.idle:
        requestIdleCallback(() => {
          details = injectScript(props)
        })
        break
      case ScriptStrategy.offMainThread:
        {
          const attributes = resolveAttributes(props)
          collectedScriptsByPage.set(pathname, attributes)
        }
        break
    }

    return (): void => {
      const { script, loadCallback, errorCallback } = details || {}

      if (loadCallback) {
        script?.removeEventListener(`load`, loadCallback)
      }

      if (errorCallback) {
        script?.removeEventListener(`error`, errorCallback)
      }

      script?.remove()
    }
  }, [])

  if (strategy === ScriptStrategy.offMainThread) {
    const inlineScript = resolveInlineScript(props)
    const attributes = resolveAttributes(props)

    if (typeof window === `undefined`) {
      collectedScriptsByPage.set(pathname, attributes)
    }

    if (inlineScript) {
      return (
        <script
          type="text/partytown"
          data-strategy={strategy}
          crossOrigin="anonymous"
          {...attributes}
          dangerouslySetInnerHTML={{ __html: resolveInlineScript(props) }}
        />
      )
    }
    return (
      <script
        type="text/partytown"
        src={proxyPartytownUrl(src)}
        data-strategy={strategy}
        crossOrigin="anonymous"
        {...attributes}
      />
    )
  }

  return null
}

interface IInjectedScriptDetails {
  script: HTMLScriptElement | null
  loadCallback: (event: Event) => void
  errorCallback: (event: ErrorEvent) => void
}

function injectScript(props: ScriptProps): IInjectedScriptDetails | null {
  const {
    id,
    src,
    strategy = ScriptStrategy.postHydrate,
    onLoad,
    onError,
  } = props || {}

  const scriptKey = id || src

  const callbackNames = [`load`, `error`]

  const currentCallbacks = {
    load: onLoad,
    error: onError,
  }

  if (scriptKey) {
    /**
     * 重複するスクリプトがすでに読み込み済み、またはエラーになっている場合は、元のイベントで load/error コールバックを再生する。
     * まだ読み込みもエラーも起きていない場合は、コールバックを記録しておき、イベントが発生したときにそれぞれの load/error コールバックを呼び出せるようにする。
     */
    for (const name of callbackNames) {
      if (currentCallbacks?.[name]) {
        const cachedCallbacks = scriptCallbackCache.get(scriptKey) || {}
        const { callbacks = [] } = cachedCallbacks?.[name] || {}
        callbacks.push(currentCallbacks?.[name])

        if (cachedCallbacks?.[name]?.event) {
          currentCallbacks?.[name]?.(cachedCallbacks?.[name]?.event)
        } else {
          scriptCallbackCache.set(scriptKey, {
            ...cachedCallbacks,
            [name]: {
              callbacks,
            },
          })
        }
      }
    }

    // 重複するスクリプトを DOM に挿入しないようにする
    if (scriptCache.has(scriptKey)) {
      return null
    }
  }

  const inlineScript = resolveInlineScript(props)
  const attributes = resolveAttributes(props)

  const script = document.createElement(`script`)

  if (id) {
    script.id = id
  }

  script.dataset.strategy = strategy

  for (const [key, value] of Object.entries(attributes)) {
    script.setAttribute(key, value)
  }

  if (inlineScript) {
    script.textContent = inlineScript
  }

  if (src) {
    script.src = src
  }

  const wrappedCallbacks: Record<string, (event: Event | ErrorEvent) => void> =
    {}

  if (scriptKey) {
    // 挿入したスクリプトにリスナーを追加し、重複を排除したスクリプトのコールバックで使えるようにイベントをキャッシュする
    for (const name of callbackNames) {
      const wrappedEventCallback = (event: Event | ErrorEvent): void =>
        onEventCallback(event, scriptKey, name)
      script.addEventListener(name, wrappedEventCallback)
      wrappedCallbacks[`${name}Callback`] = wrappedEventCallback
    }

    scriptCache.add(scriptKey)
  }

  document.body.appendChild(script)

  return {
    script,
    loadCallback: wrappedCallbacks.loadCallback,
    errorCallback: wrappedCallbacks.errorCallback,
  }
}

function resolveInlineScript(props: ScriptProps): string {
  const { dangerouslySetInnerHTML, children = `` } = props || {}
  const { __html: dangerousHTML = `` } = dangerouslySetInnerHTML || {}
  return (dangerousHTML as string) || children
}

function resolveAttributes(props: ScriptProps): Record<string, string> {
  const attributes: Record<string, string> = {}

  for (const [key, value] of Object.entries(props)) {
    if (handledProps.has(key)) {
      continue
    }
    attributes[key] = value
  }

  return attributes
}

function proxyPartytownUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  return `/__third-party-proxy?url=${encodeURIComponent(url)}`
}

function onEventCallback(
  event: Event | ErrorEvent,
  scriptKey: string,
  eventName: string
): void {
  const cachedCallbacks = scriptCallbackCache.get(scriptKey) || {}

  for (const callback of cachedCallbacks?.[eventName]?.callbacks || []) {
    callback(event)
  }

  scriptCallbackCache.set(scriptKey, { [eventName]: { event } })
}

export { GatsbyScriptLocationWrapper as Script }
