import { ActionsUnion, IActivity } from "./types"
import { ActivityStatuses } from "../constants"
import { calcElapsedTime } from "../../util/calc-elapsed-time"
import { isActivityInProgress } from "./utils"
import type { Reporter } from "../reporter"
import type { GatsbyCLIStore } from "./"

function calculateTimeoutDelay(
  envVarValue: string | undefined,
  defaultValue: number,
  min: number
): number {
  if (!envVarValue) {
    return 0
  } else if (envVarValue === `1`) {
    // 環境変数を "1" で切り替えるのはよくある使い方である。環境変数で
    // 具体的なタイムアウト値を指定できるようにしているため、この特別扱いを入れている
    // （1ms のタイムアウトはほとんど意味がなく、そのまま使うには小さすぎる）
    return defaultValue
  }

  const parsedToNumber = parseInt(envVarValue, 10)
  if (isNaN(parsedToNumber)) {
    // truthy だが数値ではないので、デフォルト値で有効にする
    return defaultValue
  }

  // 具体的なタイムアウト値を指定できるようにするが、数秒未満に
  // 設定してもほとんど役に立たないので、タイムアウトの下限も
  // 設けている。
  return Math.max(parsedToNumber, min)
}

type DiagnosticsMiddleware = (action: ActionsUnion) => void

const FIVE_MINUTES = 1000 * 60 * 5
const FIVE_SECONDS = 1000 * 5
const TEN_MINUTES = 1000 * 60 * 10
const TEN_SECONDS = 1000 * 10

export type AdditionalDiagnosticsOutputHandler = () => string
const additionalDiagnosticOutputHandlers: Array<AdditionalDiagnosticsOutputHandler> =
  []

export function registerAdditionalDiagnosticOutputHandler(
  handler: AdditionalDiagnosticsOutputHandler
): void {
  additionalDiagnosticOutputHandlers.push(handler)
}

function generateAdditionalOutput(): string {
  const extraMessages: Array<string> = []

  for (const handler of additionalDiagnosticOutputHandlers) {
    const msg = handler()

    if (msg) {
      extraMessages.push(msg)
    }
  }

  return extraMessages.length > 0
    ? `\n\nAdditional debugging logs:\n\n${extraMessages.join(`\n\n`)}`
    : ``
}

export function createStructuredLoggingDiagnosticsMiddleware(
  getStore: () => GatsbyCLIStore
): DiagnosticsMiddleware {
  const stuckStatusDiagnosticTimeoutDelay = calculateTimeoutDelay(
    process.env.GATSBY_DIAGNOSTIC_STUCK_STATUS_TIMEOUT,
    FIVE_MINUTES, // デフォルトのタイムアウト
    FIVE_SECONDS // タイムアウトの下限（主に診断コード自体のデバッグに役立つ）
  )

  const stuckStatusWatchdogTimeoutDelay = calculateTimeoutDelay(
    process.env.GATSBY_WATCHDOG_STUCK_STATUS_TIMEOUT,
    TEN_MINUTES, // デフォルトのタイムアウト
    TEN_SECONDS // タイムアウトの下限（主に診断コード自体のデバッグに役立つ）
  )

  if (!stuckStatusDiagnosticTimeoutDelay && !stuckStatusWatchdogTimeoutDelay) {
    // どのタイマーも有効ではないので、これは何もしないミドルウェアになる
    return (): void => {}
  }

  let displayedStuckStatusDiagnosticWarning = false
  let displayingStuckStatusDiagnosticWarning = false
  let stuckStatusDiagnosticTimer: NodeJS.Timeout | null = null
  let stuckStatusWatchdogTimer: NodeJS.Timeout | null = null
  let reporter: Reporter

  function inProgressActivities(): Array<
    IActivity & { diagnostics_elapsed_seconds?: string }
  > {
    const { activities } = getStore().getState().logs
    return Object.values(activities)
      .filter(activity => isActivityInProgress(activity.status))
      .map(activity => {
        if (!activity.startTime) {
          return activity
        }

        return {
          ...activity,
          diagnostics_elapsed_seconds: calcElapsedTime(activity.startTime),
        }
      })
  }

  function generateStuckStatusDiagnosticMessage(): string {
    const activities = inProgressActivities()
    return Object.values(activities)
      .map(
        activity =>
          `- Activity "${activity.text}" of type "${activity.type}" is currently in state "${activity.status}"`
      )
      .join(`\n`)
  }

  return function diagnosticMiddleware(action: ActionsUnion): void {
    // 診断ログは無視する。そうしないと、診断メッセージ自体がタイマーを
    // リセットしてしまう
    if (!displayingStuckStatusDiagnosticWarning) {
      const currentStatus = getStore().getState().logs.status

      if (!reporter) {
        // 残念ながら、ここには循環依存がある
        // そのため、この `reporter` の import は実際に必要になるまで遅らせている
        reporter = require(`../reporter`).reporter
      }

      if (stuckStatusDiagnosticTimeoutDelay) {
        if (stuckStatusDiagnosticTimer) {
          clearTimeout(stuckStatusDiagnosticTimer)
          stuckStatusDiagnosticTimer = null
        }

        if (displayedStuckStatusDiagnosticWarning) {
          // 無限再帰を防ぐために nextTick を使っている（report.warn が
          // この関数をもう一度呼び出し、それが繰り返されてしまう）
          process.nextTick(() => {
            const activitiesDiagnosticsMessage =
              generateStuckStatusDiagnosticMessage()
            reporter.warn(
              `This is just diagnostic information (enabled by GATSBY_DIAGNOSTIC_STUCK_STATUS_TIMEOUT):\n\nThere was activity since last diagnostic message. Log action:\n\n${JSON.stringify(
                action,
                null,
                2
              )}\n\nCurrently Gatsby is in: "${
                getStore().getState().logs.status
              }" state.${
                activitiesDiagnosticsMessage.length > 0
                  ? `\n\nActivities preventing Gatsby from transitioning to idle state:\n\n${activitiesDiagnosticsMessage}`
                  : ``
              }`
            )
          })
          displayedStuckStatusDiagnosticWarning = false
        }

        if (currentStatus === ActivityStatuses.InProgress) {
          stuckStatusDiagnosticTimer = setTimeout(
            function logStuckStatusDiagnostic() {
              displayingStuckStatusDiagnosticWarning = true
              reporter.warn(
                `This is just diagnostic information (enabled by GATSBY_DIAGNOSTIC_STUCK_STATUS_TIMEOUT):\n\nGatsby is in "${
                  getStore().getState().logs.status
                }" state without any updates for ${(
                  stuckStatusDiagnosticTimeoutDelay / 1000
                ).toFixed(
                  3
                )} seconds. Activities preventing Gatsby from transitioning to idle state:\n\n${generateStuckStatusDiagnosticMessage()}${
                  stuckStatusWatchdogTimeoutDelay
                    ? `\n\nProcess will be terminated in ${(
                        (stuckStatusWatchdogTimeoutDelay -
                          stuckStatusDiagnosticTimeoutDelay) /
                        1000
                      ).toFixed(3)} seconds if nothing will change.`
                    : ``
                }${generateAdditionalOutput()}`
              )
              displayingStuckStatusDiagnosticWarning = false
              displayedStuckStatusDiagnosticWarning = true
            },
            stuckStatusDiagnosticTimeoutDelay
          )
        }
      }

      if (stuckStatusWatchdogTimeoutDelay) {
        if (stuckStatusWatchdogTimer) {
          clearTimeout(stuckStatusWatchdogTimer)
          stuckStatusWatchdogTimer = null
        }

        if (currentStatus === ActivityStatuses.InProgress) {
          stuckStatusWatchdogTimer = setTimeout(
            function fatalStuckStatusHandler() {
              reporter.panic({
                id: `11701`,
                context: {
                  activities: inProgressActivities(),
                  status: getStore().getState().logs.status,
                  stuckStatusDiagnosticMessage:
                    generateStuckStatusDiagnosticMessage(),
                  stuckStatusWatchdogTimeoutDelay,
                  additionalOutput: generateAdditionalOutput(),
                },
              })
            },
            stuckStatusWatchdogTimeoutDelay
          )
        }
      }
    }
  }
}
