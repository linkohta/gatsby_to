import { isWorker } from "gatsby-worker"
import { initJobsMessagingInWorker } from "../../jobs/worker-messaging"
import { initReporterMessagingInWorker } from "../reporter"

initJobsMessagingInWorker()
initReporterMessagingInWorker()

// develop や build と同じように、グローバルの gatsby オブジェクトを設定する
if (isWorker) {
  global.__GATSBY = process.env.GATSBY_NODE_GLOBALS
    ? JSON.parse(process.env.GATSBY_NODE_GLOBALS)
    : {}
}

export {
  renderHTMLProd,
  renderHTMLDev,
  renderPartialHydrationProd,
  renderSlices,
} from "./render-html"
export { setInferenceMetadata, buildSchema } from "./schema"
export { setComponents, runQueries, saveQueriesDependencies } from "./queries"
export { loadConfigAndPlugins } from "./load-config-and-plugins"

// Gatsby がワーカーに最新版の `public/render-page.js` を強制的に読み込ませられるようにする
export function deleteModuleCache(htmlComponentRendererPath: string): void {
  delete require.cache[require.resolve(htmlComponentRendererPath)]
}
