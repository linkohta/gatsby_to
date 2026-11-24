import {
  customizeSchema,
  createPages,
  buildSchema,
  sourceNodes,
  writeOutRedirects as writeOutRedirectsAndWatch,
} from "../../services"
import { fromService } from "../from-service"

export const dataLayerServices = {
  customizeSchema: fromService(customizeSchema),
  sourceNodes: fromService(sourceNodes),
  createPages: fromService(createPages),
  buildSchema: fromService(buildSchema),
  writeOutRedirectsAndWatch: fromService(writeOutRedirectsAndWatch),
}
