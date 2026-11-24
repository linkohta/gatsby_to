import { assign, AnyEventObject, DoneActorEvent } from "xstate"
import { createGraphQLRunner } from "../../bootstrap/create-graphql-runner"
import reporter from "gatsby-cli/lib/reporter"
import { IDataLayerContext } from "./types"
import { assertStore } from "../../utils/assert-store"
import { GraphQLRunner } from "../../query/graphql-runner"

interface IDataLayerActionArgs {
  context: IDataLayerContext
  event: AnyEventObject
}

const concatUnique = <T>(
  array1: Array<T> = [],
  array2: Array<T> = []
): Array<T> => Array.from(new Set(array1.concat(array2)))

export const assignChangedPages = assign(
  ({ context, event }: IDataLayerActionArgs) => {
    const { output } = event as DoneActorEvent<{
      changedPages: Array<string>
      deletedPages: Array<string>
    }>

    return {
      pagesToBuild: concatUnique(context.pagesToBuild, output.changedPages),
      pagesToDelete: concatUnique(context.pagesToDelete, output.deletedPages),
    }
  }
)

export const assignGraphQLRunners = assign(
  ({ context: { store, program } }: IDataLayerActionArgs) => {
    assertStore(store)
    return {
      gatsbyNodeGraphQLFunction: createGraphQLRunner(store, reporter),
      graphqlRunner: new GraphQLRunner(store, {
        collectStats: true,
        graphqlTracing: program?.graphqlTracing,
      }),
    }
  }
)

export const dataLayerActions = {
  assignChangedPages,
  assignGraphQLRunners,
}
