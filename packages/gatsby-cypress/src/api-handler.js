/* eslint-disable @babel/no-invalid-this */
let resolve = null
let awaitingAPI = null

export function waitForAPI(api) {
  const promise = new Promise(r => {
    resolve = r
  })
  awaitingAPI = api

  if (this.___resolvedAPIs && this.___resolvedAPIs.includes(api)) {
    // API が解決済みとしてマークされている場合は、
    // すぐに解決して変数をリセットする。
    awaitingAPI = null
    this.___resolvedAPIs = []
    resolve()
  }
  return promise
}

export default function apiHandler(api) {
  if (!awaitingAPI) {
    // 今は何も待っていない場合は、
    // API を解決済みとしてマークする。
    this.___resolvedAPIs.push(api)
  } else if (api === awaitingAPI) {
    // 何かを待っていたのであれば、ここで解決する。
    awaitingAPI = null
    this.___resolvedAPIs = []
    resolve()
  }
}
