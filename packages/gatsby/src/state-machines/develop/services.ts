import {
  startWebpackServer,
  initialize,
  recompile,
  postBootstrap,
  graphQLTypegen,
} from "../../services"
import {
  initializeDataMachine,
  reloadDataMachine,
  recreatePagesMachine,
} from "../data-layer"
import { queryRunningMachine } from "../query-running"
import { waitingMachine } from "../waiting"
import { fromService } from "../from-service"

export const developServices = {
  initializeData: initializeDataMachine,
  reloadData: reloadDataMachine,
  recreatePages: recreatePagesMachine,
  initialize: fromService(initialize),
  runQueries: queryRunningMachine,
  waitForMutations: waitingMachine,
  startWebpackServer: fromService(startWebpackServer),
  recompile: fromService(recompile),
  postBootstrap: fromService(postBootstrap),
  graphQLTypegen: fromService(graphQLTypegen),
}
