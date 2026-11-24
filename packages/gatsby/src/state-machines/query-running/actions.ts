import { IQueryRunningContext } from "./types"
import { DoneActorEvent, assign, AnyEventObject } from "xstate"
import { enqueueFlush } from "../../utils/page-data"

interface IQueryRunningActionArgs {
  context: IQueryRunningContext
  event: AnyEventObject
}

export const flushPageData = ({ context }: IQueryRunningActionArgs): void => {
  enqueueFlush(context.parentSpan)
}

export const assignDirtyQueries = assign(
  ({ event }: IQueryRunningActionArgs) => {
    const { queryIds } = (event as DoneActorEvent<any>).output
    return {
      queryIds,
    }
  }
)

export const markSourceFilesDirty = assign({
  filesDirty: true,
})

export const markSourceFilesClean = assign({
  filesDirty: false,
})

export const trackRequestedQueryRun = assign({
  pendingQueryRuns: ({
    context,
    event: { payload },
  }: IQueryRunningActionArgs) => {
    const pendingQueryRuns = context.pendingQueryRuns || new Set<string>()
    if (payload?.pagePath) {
      pendingQueryRuns.add(payload.pagePath)
    }
    return pendingQueryRuns
  },
})

export const clearCurrentlyHandledPendingQueryRuns = assign({
  currentlyHandledPendingQueryRuns: undefined,
})

export const queryActions = {
  assignDirtyQueries,
  flushPageData,
  markSourceFilesDirty,
  markSourceFilesClean,
  trackRequestedQueryRun,
  clearCurrentlyHandledPendingQueryRuns,
}
