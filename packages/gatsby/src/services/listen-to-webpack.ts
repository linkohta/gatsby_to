import { Compiler } from "webpack"
import { fromCallback, AnyEventObject, CallbackActorLogic } from "xstate"
import reporter from "gatsby-cli/lib/reporter"

export const createWebpackWatcher = (
  compiler: Compiler
): CallbackActorLogic<AnyEventObject> =>
  fromCallback<AnyEventObject>(({ sendBack }) => {
    compiler.hooks.invalid.tap(`file invalidation`, file => {
      reporter.verbose(`Webpack file changed: ${file}`)
      sendBack({ type: `SOURCE_FILE_CHANGED`, file })
    })
  })
