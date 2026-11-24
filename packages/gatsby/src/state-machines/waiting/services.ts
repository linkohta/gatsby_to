import { runMutationBatch } from "../../services"
import { fromService } from "../from-service"

export const waitingServices = {
  runMutationBatch: fromService(runMutationBatch),
}
