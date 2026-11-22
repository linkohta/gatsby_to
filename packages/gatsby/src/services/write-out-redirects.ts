import reporter from "gatsby-cli/lib/reporter"
import {
  writeRedirects,
  startRedirectListener,
} from "../bootstrap/redirects-writer"
import { IQueryRunningContext } from "../state-machines/query-running/types"

export async function writeOutRedirects({
  parentSpan,
}: Partial<IQueryRunningContext>): Promise<void> {
  // リダイレクトを書き出す。
  const activity = reporter.activityTimer(`write out redirect data`, {
    parentSpan,
  })
  activity.start()
  await writeRedirects()
  startRedirectListener()
  activity.end()
}
