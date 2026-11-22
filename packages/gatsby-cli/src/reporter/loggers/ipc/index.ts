import { onLogAction } from "../../redux/index"
import { ISetStatus, ActionsUnion } from "../../redux/types"
import { Actions, LogLevels } from "../../constants"
import stripAnsi from "strip-ansi"
import { cloneDeep } from "lodash"

const isStringPayload = (action: ActionsUnion): action is ISetStatus =>
  typeof action.payload === `string`

/**
 * payload は String か Object のどちらかである
 * 詳しくは integration-tests/structured-logging/__tests__/to-do.js を参照
 */
const sanitizeAction = (action: ActionsUnion): ActionsUnion => {
  const copiedAction = cloneDeep(action)

  if (isStringPayload(copiedAction)) {
    return copiedAction
  }

  if (`text` in copiedAction.payload && copiedAction.payload.text) {
    copiedAction.payload.text = stripAnsi(copiedAction.payload.text)
  }
  if (`statusText` in copiedAction.payload && copiedAction.payload.statusText) {
    copiedAction.payload.statusText = stripAnsi(copiedAction.payload.statusText)
  }

  return copiedAction
}

export const initializeIPCLogger = (): void => {
  onLogAction((action: ActionsUnion) => {
    if (!process.send) return

    const sanitizedAction = sanitizeAction(action)

    // sanitizedAction を書き換えているが、これはすでに action のディープコピーなので問題ないはずである
    if (sanitizedAction.type === Actions.Log) {
      // Debug は IPC 経由では送らない
      if (
        [LogLevels.Debug].includes(sanitizedAction.payload.level as LogLevels)
      ) {
        return
      }
      // IPC 経由では、Success と Log の種別を Info に上書きする
      if (
        [LogLevels.Success, LogLevels.Log].includes(
          sanitizedAction.payload.level as LogLevels
        )
      ) {
        sanitizedAction.payload.level = LogLevels.Info
      }
    }

    process.send({
      type: Actions.LogAction,
      action: sanitizedAction,
    })
  })
}
