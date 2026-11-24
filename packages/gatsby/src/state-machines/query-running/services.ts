import {
  extractQueries,
  writeOutRequires,
  calculateDirtyQueries,
  runStaticQueries,
  runPageQueries,
  runSliceQueries,
  waitUntilAllJobsComplete,
  writeOutRedirects,
} from "../../services"
import { fromService } from "../from-service"

export const queryRunningServices = {
  extractQueries: fromService(extractQueries),
  writeOutRequires: fromService(writeOutRequires),
  calculateDirtyQueries: fromService(calculateDirtyQueries),
  runStaticQueries: fromService(runStaticQueries),
  runPageQueries: fromService(runPageQueries),
  runSliceQueries: fromService(runSliceQueries),
  waitUntilAllJobsComplete: fromService(waitUntilAllJobsComplete),
  writeOutRedirects: fromService(writeOutRedirects),
}
