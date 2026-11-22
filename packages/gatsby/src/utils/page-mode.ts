import { store } from "../redux"
import {
  IGatsbyPage,
  IGatsbyState,
  IMaterializePageMode,
  PageMode,
} from "../redux/types"
import { reportOnce } from "./report-once"
import { ROUTES_DIRECTORY } from "../constants"
import { Runner } from "../bootstrap/create-graphql-runner"
import { getDataStore } from "../datastore"

type IPageConfigFn = (arg: { params: Record<string, unknown> }) => {
  defer: boolean
}

const pageConfigMap = new Map<string, IPageConfigFn>()

/**
 * develop では、IGatsbyPage["mode"] はいつでも変わりうる。そのため原則として、
 * ページコンポーネントと IGatsbyPage["defer"] の値から毎回解決する必要がある。
 *
 * IGatsbyPage["mode"] が信頼できるのは、エンジンの中と `onPostBuild` フックの中だけである。
 */
export function getPageMode(page: IGatsbyPage, state?: IGatsbyState): PageMode {
  const { components } = state ?? store.getState()

  // コンポーネントが実際に抽出されるまでは、SSG と仮定する
  const component = components.get(page.componentPath) ?? {
    serverData: false,
    config: false,
  }

  return resolvePageMode(page, component)
}

function resolvePageMode(
  page: IGatsbyPage,
  component: { serverData: boolean; config: boolean }
): PageMode {
  let pageMode: PageMode | undefined = undefined
  if (component.serverData) {
    pageMode = `SSR`
  } else if (component.config) {
    const pageConfigFn = pageConfigMap.get(page.componentChunkName)
    if (!pageConfigFn) {
      // これは、ウォームビルドで、`component.config` は永続化されているが
      // `preparePageTemplateConfigs` がまだ実行されていない場合に起こりうる
      // TODO: `mode` をページから切り離して状態の中で別に永続化すれば、
      //  `component.config` と同期しているはずの古い `mode` を返すだけで済む
      return `SSG`
    }

    const fsRouteParams = (
      typeof page.context[`__params`] === `object`
        ? page.context[`__params`]
        : {}
    ) as Record<string, unknown>

    const pageConfig = pageConfigFn({ params: fsRouteParams })
    if (typeof pageConfig.defer === `boolean`) {
      pageMode = pageConfig.defer ? `DSG` : `SSG`
    }
  }

  if (!pageMode) {
    pageMode = page.defer ? `DSG` : `SSG`
  }
  if (
    pageMode !== `SSG` &&
    (page.path === `/404.html` || page.path === `/500.html`)
  ) {
    reportOnce(
      `Status page "${page.path}" ignores page mode ("${pageMode}") and force sets it to SSG (this page can't be lazily rendered).`
    )
    pageMode = `SSG`
  }

  return pageMode
}

/**
 * SSR/DSG のページが `gatsby serve` で動くように、page.mode を永続化する
 *
 * TODO: 理想的には、IGatsbyPage["mode"] は存在すべきではなく、この情報を持つ別のエンティティが
 *   必要である。ビルドの最後にだけ作成されるエンティティ（たとえば Route）である
 *   そうなれば、materializePageMode は createRoutes に変わる
 */
export async function materializePageMode(): Promise<void> {
  const { pages, components } = store.getState()

  let dispatchCount = 0
  for (const page of pages.values()) {
    const component = components.get(page.componentPath)
    if (!component) {
      throw new Error(`Could not find matching component for page ${page.path}`)
    }
    const pageMode = resolvePageMode(page, component)

    // SSG のページについてはマテリアライズしない。ページを作成するとき、デフォルトで `page.mode` === `SSG` なので、CPU 時間を節約できる
    // また、ページはビルドのたびに再生成され、永続化されない
    // （そのため、前回のビルドの DSG/SSR の値を得る方法はない）
    if (pageMode !== `SSG`) {
      const action: IMaterializePageMode = {
        type: `MATERIALIZE_PAGE_MODE`,
        payload: { path: page.path, pageMode },
      }
      store.dispatch(action)
    }
    // イベントループのタスクキューを長時間ブロックしない:
    if (dispatchCount++ % 100 === 0) {
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  await getDataStore().ready()
}

export async function preparePageTemplateConfigs(
  graphql: Runner
): Promise<void> {
  const { program } = store.getState()
  const pageRendererPath = `${program.directory}/${ROUTES_DIRECTORY}render-page.js`

  const pageRenderer = require(pageRendererPath)
  global[`__gatsbyGraphql`] = graphql

  await Promise.all(
    Array.from(store.getState().components.values()).map(async component => {
      if (component.config) {
        const componentInstance = await pageRenderer.getPageChunk({
          componentChunkName: component.componentChunkName,
        })
        const pageConfigFn = await componentInstance.config()
        if (typeof pageConfigFn !== `function`) {
          throw new Error(
            `Unexpected result of config factory. Expected "function", got "${typeof pageConfigFn}".`
          )
        }

        pageConfigMap.set(component.componentChunkName, pageConfigFn)
      }
    })
  )
  delete global[`__gatsbyGraphql`]
}
