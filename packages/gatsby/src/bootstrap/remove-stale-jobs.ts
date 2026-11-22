import {
  IGatsbyState,
  IRemoveStaleJobV2Action,
  ICreateJobV2FromInternalAction,
} from "../redux/types"

import { isJobStale } from "../utils/jobs/manager"
import { internalActions } from "../redux/actions"

export const removeStaleJobs = (
  jobs: IGatsbyState["jobsV2"]
): Array<IRemoveStaleJobV2Action | ICreateJobV2FromInternalAction> => {
  const actions: Array<
    IRemoveStaleJobV2Action | ICreateJobV2FromInternalAction
  > = []

  // 完了済みのジョブのうち古くなったものは、キャッシュを小さく保つために削除する
  jobs.complete.forEach((job, contentDigest) => {
    if (isJobStale(job)) {
      actions.push(internalActions.removeStaleJob(contentDigest))
    }
  })

  // 保留中のジョブのうち、inputPath が存在しないもの、または inputPath が変わったものは、
  // いずれにせよ失敗するのでキューから取り除く
  jobs.incomplete.forEach(({ job }): void => {
    if (isJobStale(job)) {
      actions.push(internalActions.removeStaleJob(job.contentDigest))
    } else {
      actions.push(internalActions.createJobV2FromInternalJob(job))
    }
  })

  return actions
}
