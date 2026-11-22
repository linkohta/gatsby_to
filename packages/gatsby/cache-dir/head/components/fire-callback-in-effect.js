import { useEffect } from "react"

/*
 * effect の中でコールバックを呼び、children をレンダリングする
 */
export function FireCallbackInEffect({ children, callback }) {
  useEffect(() => {
    callback()
  })

  return children
}
