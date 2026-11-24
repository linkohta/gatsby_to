import { createMachine, MachineConfig, AnyEventObject } from "xstate"
import { dataLayerActions } from "./actions"
import { IDataLayerContext } from "./types"
import { dataLayerServices } from "./services"
import { contextAsInput } from "../from-service"

export type DataLayerResult = Pick<
  IDataLayerContext,
  | `gatsbyNodeGraphQLFunction`
  | `graphqlRunner`
  | `pagesToBuild`
  | `pagesToDelete`
>

type DataLayerStates = NonNullable<
  MachineConfig<IDataLayerContext, AnyEventObject>[`states`]
>

const loadDataStates: DataLayerStates = {
  customizingSchema: {
    invoke: {
      src: `customizeSchema`,
      input: contextAsInput,
      id: `customizing-schema`,
      onDone: {
        target: `sourcingNodes`,
      },
    },
  },
  sourcingNodes: {
    invoke: {
      src: `sourceNodes`,
      input: contextAsInput,
      id: `sourcing-nodes`,
      onDone: {
        target: `buildingSchema`,
        actions: `assignChangedPages`,
      },
    },
  },
}

const initialCreatePagesStates: DataLayerStates = {
  buildingSchema: {
    invoke: {
      id: `building-schema`,
      src: `buildSchema`,
      input: contextAsInput,
      onDone: {
        target: `creatingPages`,
        actions: `assignGraphQLRunners`,
      },
    },
  },
  creatingPages: {
    invoke: {
      id: `creating-pages`,
      src: `createPages`,
      input: contextAsInput,
      onDone: {
        target: `writingOutRedirects`,
        actions: `assignChangedPages`,
      },
    },
  },
  writingOutRedirects: {
    invoke: {
      src: `writeOutRedirectsAndWatch`,
      input: contextAsInput,
      onDone: {
        target: `done`,
      },
    },
  },
}

const recreatePagesStates: DataLayerStates = {
  buildingSchema: {
    invoke: {
      id: `building-schema`,
      src: `buildSchema`,
      input: contextAsInput,
      onDone: {
        target: `creatingPages`,
        actions: `assignGraphQLRunners`,
      },
    },
  },
  creatingPages: {
    invoke: {
      id: `creating-pages`,
      src: `createPages`,
      input: contextAsInput,
      onDone: {
        target: `done`,
        actions: `assignChangedPages`,
      },
    },
  },
}

const doneState: DataLayerStates = {
  done: {
    type: `final`,
  },
}

// 最終状態に達したときに、親のマシンへ返す値
const output = ({
  context: {
    gatsbyNodeGraphQLFunction,
    graphqlRunner,
    pagesToBuild,
    pagesToDelete,
  },
}: {
  context: IDataLayerContext
}): DataLayerResult => {
  return {
    gatsbyNodeGraphQLFunction,
    graphqlRunner,
    pagesToBuild,
    pagesToDelete,
  }
}

// 親のマシンが invoke の `input` で渡した値を、そのままコンテキストにする
const context = ({ input }: { input?: IDataLayerContext }): IDataLayerContext =>
  input ?? {}

const types = {} as {
  context: IDataLayerContext
  events: AnyEventObject
  input: IDataLayerContext | undefined
  output: DataLayerResult
}

const options = {
  actions: dataLayerActions,
  actors: dataLayerServices,
}

/**
 * 初回の実行で使うマシン
 */

export const initializeDataMachine = createMachine(
  {
    types,
    id: `initializeDataMachine`,
    context,
    output,
    initial: `customizingSchema`,
    states: {
      ...loadDataStates,
      ...initialCreatePagesStates,
      ...doneState,
    },
  },
  options
)

/**
 * ノードをもう一度取得する必要があるときに使うマシン
 */

export const reloadDataMachine = createMachine(
  {
    types,
    id: `reloadDataMachine`,
    context,
    output,
    initial: `customizingSchema`,
    states: {
      ...loadDataStates,
      ...recreatePagesStates,
      ...doneState,
    },
  },
  options
)

/**
 * sourceNodes の外でノードが変更された後に、ページを
 * 作り直す必要があるときに使うマシン
 */
export const recreatePagesMachine = createMachine(
  {
    types,
    id: `recreatePagesMachine`,
    context,
    output,
    initial: `buildingSchema`,
    states: {
      ...recreatePagesStates,
      ...doneState,
    },
  },
  options
)
