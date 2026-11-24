import { emitter } from "../redux"
import { fromCallback, AnyEventObject } from "xstate"

export const listenForMutations = fromCallback<AnyEventObject>(
  ({ sendBack }) => {
    const emitMutation = (event: unknown): void => {
      sendBack({ type: `ADD_NODE_MUTATION`, payload: event })
    }

    const emitSourceChange = (event: unknown): void => {
      sendBack({ type: `SOURCE_FILE_CHANGED`, payload: event })
    }

    const emitWebhook = (event: unknown): void => {
      sendBack({ type: `WEBHOOK_RECEIVED`, payload: event })
    }

    const emitQueryRunRequest = (event: unknown): void => {
      sendBack({ type: `QUERY_RUN_REQUESTED`, payload: event })
    }

    const emitSetSchema = (event: unknown): void => {
      sendBack({ type: `SET_SCHEMA`, payload: event })
    }

    const emitGraphQLDefinitions = (event: unknown): void => {
      sendBack({ type: `SET_GRAPHQL_DEFINITIONS`, payload: event })
    }

    emitter.on(`ENQUEUE_NODE_MUTATION`, emitMutation)
    emitter.on(`WEBHOOK_RECEIVED`, emitWebhook)
    emitter.on(`SOURCE_FILE_CHANGED`, emitSourceChange)
    emitter.on(`QUERY_RUN_REQUESTED`, emitQueryRunRequest)
    emitter.on(`SET_SCHEMA`, emitSetSchema)
    emitter.on(`SET_GRAPHQL_DEFINITIONS`, emitGraphQLDefinitions)

    return function unsubscribeFromMutationListening(): void {
      emitter.off(`ENQUEUE_NODE_MUTATION`, emitMutation)
      emitter.off(`WEBHOOK_RECEIVED`, emitWebhook)
      emitter.off(`SOURCE_FILE_CHANGED`, emitSourceChange)
      emitter.off(`QUERY_RUN_REQUESTED`, emitQueryRunRequest)
      emitter.off(`SET_SCHEMA`, emitSetSchema)
      emitter.off(`SET_GRAPHQL_DEFINITIONS`, emitGraphQLDefinitions)
    }
  }
)
