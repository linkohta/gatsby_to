/*
 * このモジュールは、ユーザーが cmd+c で gatsby のプロセスを終了させたことを検知するために使う
 * その場合に実行しなければならない後始末の処理がある
 */
import signalExit from "signal-exit"
import { getStore } from "./redux"
import { createPendingActivity } from "./redux/actions"
import { ActivityStatuses } from "./constants"
import { reporter } from "./reporter"

const interruptActivities = (): void => {
  const { activities } = getStore().getState().logs
  Object.keys(activities).forEach(activityId => {
    const activity = activities[activityId]
    if (
      activity.status === ActivityStatuses.InProgress ||
      activity.status === ActivityStatuses.NotStarted
    ) {
      reporter.completeActivity(activityId, ActivityStatuses.Interrupted)
    }
  })
}

export const prematureEnd = (): void => {
  // 少なくとも 1 つのアクティビティを確実に失敗させるためのハック。
  // 明示的に失敗したアクティビティが 1 つもない場合でも、
  // FAILED ステータスが必ず生成されるようにする
  createPendingActivity({
    id: `panic`,
    status: ActivityStatuses.Failed,
  })

  interruptActivities()
}

export const catchExitSignals = (): void => {
  signalExit((code, signal) => {
    if (code !== 0 && signal !== `SIGINT` && signal !== `SIGTERM`)
      prematureEnd()
    else interruptActivities()
  })
}
