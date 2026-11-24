/***
 * このモジュールの役割
 * - Redux ストアの中のコンポーネントの一覧を維持する。そのために新しいコンポーネントを
 *   監視して、コンポーネントを追加または削除する。
 * - コンポーネントのクエリの変更を監視し、クエリを抽出してストアを更新する。
 * - bootstrap の一部としてすべてのページクエリが実行されるようにし、完了したら
 *   それを報告する
 * - クエリが変更されるたびに、そのクエリに依存するすべてのページを再実行する。
 ***/

import chokidar, { FSWatcher } from "chokidar"
import { Span } from "opentracing"

import path from "path"
import { getPathToLayoutComponent } from "gatsby-core-utils/parse-component-path"
import { slash } from "gatsby-core-utils/path"
import {
  createGlobWatchFilter,
  IGlobWatchFilter,
} from "gatsby-core-utils/watch-globs"

import { store, emitter } from "../redux/"
import { actions } from "../redux/actions"
import { IGatsbyStaticQueryComponents } from "../redux/types"
import queryCompiler from "./query-compiler"
import report from "gatsby-cli/lib/reporter"
import { getGatsbyDependents } from "../utils/gatsby-dependents"
import { processNodeManifests } from "../utils/node-manifest"

const debug = require(`debug`)(`gatsby:query-watcher`)

interface IComponent {
  componentPath: string
  query: string
  pages: Set<string>
  isInBootstrap: boolean
}

interface IQuery {
  id: string
  name: string
  text: string
  originalText: string
  path: string
  isHook: boolean
  isStaticQuery: boolean
  hash: string
}

interface IQuerySnapshot {
  components: Map<string, IComponent>
  staticQueryComponents: Map<string, IGatsbyStaticQueryComponents>
  componentsWithCleanFilePaths: Set<string>
}

const getQueriesSnapshot = (): IQuerySnapshot => {
  const state = store.getState()

  const componentsWithCleanFilePaths: Set<string> = new Set()

  state.components.forEach(c => {
    componentsWithCleanFilePaths.add(getPathToLayoutComponent(c.componentPath))
  })

  const snapshot: IQuerySnapshot = {
    components: new Map<string, IComponent>(state.components),
    staticQueryComponents: new Map<string, IGatsbyStaticQueryComponents>(
      state.staticQueryComponents
    ),
    componentsWithCleanFilePaths,
  }

  return snapshot
}

const handleComponentsWithRemovedQueries = (
  { staticQueryComponents }: IQuerySnapshot,
  queries: Map<string, IQuery>
): void => {
  // コンポーネントに静的クエリがあったが、今はもうない場合は、
  // ストアを更新する
  staticQueryComponents.forEach(c => {
    if (c.query !== `` && !queries.has(c.componentPath)) {
      debug(`Static query was removed from ${c.componentPath}`)
      store.dispatch({
        type: `REMOVE_STATIC_QUERY`,
        payload: c.id,
      })
    }
  })
}

const handleQuery = (
  { staticQueryComponents }: IQuerySnapshot,
  query: IQuery,
  component: string
): boolean => {
  // これが静的クエリである場合
  // アクションとレデューサーを追加し、staticquery のファイルを監視する
  if (query.isStaticQuery) {
    const oldQuery = staticQueryComponents.get(query.id)
    const isNewQuery = !oldQuery

    // クエリのテキストを比較する。テキストは、関連するフラグメントを含めてコンパイルされた
    // クエリであり、フラグメントが編集されたときにもクエリを再実行したいためである。
    // ハッシュも比較する。ハッシュは、開発時にクエリを識別してコンポーネントへデータを
    // 渡すために使われるためである。ユーザーがクエリのテキストを整形するとハッシュは変わりうるが、
    // それはコンパイルされたテキストが変わることを意味しない。
    if (
      isNewQuery ||
      oldQuery?.hash !== query.hash ||
      oldQuery?.query !== query.text
    ) {
      store.dispatch(
        actions.replaceStaticQuery({
          name: query.name,
          componentPath: query.path,
          id: query.id,
          query: query.text,
          hash: query.hash,
        })
      )

      debug(
        `Static query in ${component} ${
          isNewQuery ? `was added` : `has changed`
        }.`
      )
    }
    return true
  }

  return false
}

const filesToWatch = new Set<string>()
let watcher: FSWatcher
let watchFilter: IGlobWatchFilter

const watch = async (rootDir: string): Promise<void> => {
  if (watcher) return

  const modulesThatUseGatsby = await getGatsbyDependents()

  const packagePaths = modulesThatUseGatsby.map(module => {
    const filesRegex = `*.+(t|j)s?(x)`
    const pathRegex = `/{${filesRegex},!(node_modules)/**/${filesRegex}}`
    return slash(path.join(module.path, pathRegex))
  })

  // chokidar 4 以降は glob を監視できないので、glob を親フォルダーの監視と絞り込みに置き換える
  watchFilter = createGlobWatchFilter({ ignored: [`**/*.d.ts`] })

  watcher = chokidar
    .watch(
      watchFilter.add([
        slash(path.join(rootDir, `/src/**/*.{js,jsx,ts,tsx}`)),
        ...packagePaths,
      ]),
      { ignoreInitial: true, ignored: watchFilter.ignored }
    )
    .on(`change`, path => {
      emitter.emit(`SOURCE_FILE_CHANGED`, path)
    })
    .on(`add`, path => {
      emitter.emit(`SOURCE_FILE_CHANGED`, path)
    })
    .on(`unlink`, path => {
      emitter.emit(`SOURCE_FILE_CHANGED`, path)
    })

  filesToWatch.forEach(filePath => watcher.add(watchFilter.add(filePath)))
}

const watchComponent = (componentPath: string): void => {
  // 監視は bootstrap の途中まで始めないので、それまでに追加された新しい
  // コンポーネントは無視する。これは何にも影響しない。bootstrap から
  // extractQueries が呼ばれるときに、すべてのコンポーネントが監視されている
  // ことを保証しているためである。
  if (
    process.env.NODE_ENV !== `production` &&
    !filesToWatch.has(componentPath)
  ) {
    filesToWatch.add(componentPath)
    if (watcher) {
      watcher.add(watchFilter.add(componentPath))
    }
  }
}

/**
 * どのページからも使われていないコンポーネントテンプレートを redux ストアから取り除く。
 */
const clearInactiveComponents = (): void => {
  const { components, pages, slices } = store.getState()

  const activeTemplates = new Set()
  pages.forEach(page => {
    // Set を使うことで、エントリーが重複しないことが保証される
    activeTemplates.add(slash(page.componentPath))
  })
  slices.forEach(slice => {
    // Set を使うことで、エントリーが重複しないことが保証される
    activeTemplates.add(slash(slice.componentPath))
  })

  components.forEach(component => {
    if (!activeTemplates.has(component.componentPath)) {
      debug(
        `${component.componentPath} component was removed because it isn't used by any page`
      )
      store.dispatch({
        type: `REMOVE_STATIC_QUERIES_BY_TEMPLATE`,
        payload: component,
      })
    }
  })
}

export const startWatchDeletePage = (): void => {
  emitter.on(`DELETE_PAGE`, action => {
    const componentPath = slash(action.payload.component)
    const { pages } = store.getState()
    let otherPageWithTemplateExists = false
    for (const page of pages.values()) {
      if (slash(page.component) === componentPath) {
        otherPageWithTemplateExists = true
        break
      }
    }
    if (!otherPageWithTemplateExists) {
      store.dispatch({
        type: `REMOVE_STATIC_QUERIES_BY_TEMPLATE`,
        payload: {
          componentPath,
        },
      })
    }
  })
}

export const updateStateAndRunQueries = async (
  isFirstRun: boolean,
  { parentSpan }: { parentSpan?: Span } = {}
): Promise<void> => {
  const snapshot = getQueriesSnapshot()
  const queries: Map<string, IQuery> = await queryCompiler({ parentSpan })
  // クエリの抽出中にエラーが起きると、queryCompiler は false か
  // 0 件の結果を返す。
  // 本来はおそらくエラーにすべきだが、エラーをここまで引き回す
  // 気にはなれない。
  if (!queries || queries.size === 0) {
    return
  }
  handleComponentsWithRemovedQueries(snapshot, queries)

  // それぞれのコンポーネントに対してアクションを実行する
  snapshot.components.forEach(c => {
    const { isStaticQuery = false, text = `` } =
      queries.get(c.componentPath) || {}

    store.dispatch(
      actions.queryExtracted({
        componentPath: c.componentPath,
        query: isStaticQuery ? `` : text,
      })
    )
  })

  let queriesWillNotRun = false
  queries.forEach((query, component) => {
    const queryWillRun = handleQuery(snapshot, query, component)

    if (queryWillRun) {
      watchComponent(component)
      // これがページコンポーネントであるかを確認する。
      // そうであり、かつ bootstrap 中の最初の実行である場合は、
      // ページでないコンポーネントにクエリがあることについての警告を表示する。
    } else if (
      isFirstRun &&
      !snapshot.componentsWithCleanFilePaths.has(
        getPathToLayoutComponent(component)
      )
    ) {
      report.warn(
        `The GraphQL query in the non-page component "${component}" will not be run.`
      )
      queriesWillNotRun = true
    }
  })

  if (queriesWillNotRun) {
    report.log(report.stripIndent`

        Exported queries are only executed for page components. It's possible you're trying to create pages in your gatsby-node.js and that's failing for some reason.

        If the failing component is a regular component and not intended to be a page component, you generally want to use "useStaticQuery" (https://www.gatsbyjs.com/docs/how-to/querying-data/use-static-query/) instead of exporting a page query.

        If you're more experienced with GraphQL, you can also export GraphQL fragments from components and compose the fragments in the Page component query and pass data down into the child component (https://www.gatsbyjs.com/docs/reference/graphql-data-layer/using-graphql-fragments/)

      `)
  }

  if (process.env.NODE_ENV === `development`) {
    /**
     * ここでノードマニフェストを処理するのは develop のときだけである。クエリが更新されるたびにこれを実行したい。gatsby build では、すべてのクエリが実行されてページが作成された後に、src/utils/page-data.ts でノードマニフェストを処理する。gatsby build のときにこの場所でノードマニフェストを処理すると、マニフェストの作成に必要な情報がそろっていない。gatsby develop のときにこの場所でマニフェストを処理しないと、マニフェストは一度しか書き出されず、その後にマニフェストが作られても二度と書き出されない。
     */
    await processNodeManifests()
  }
}

export const extractQueries = ({
  parentSpan,
}: { parentSpan?: Span } = {}): Promise<void> => {
  // 存在しないページテンプレートを指しているテンプレートコンポーネントを取り除く。
  // これが必要なのは、コンポーネントのデータがキャッシュされており、開発サーバーが
  // 動いていない間に変更が加えられているかもしれないためである。必要なのは
  // 初回の実行だけである。開発中は状態が調整されていくためである。
  clearInactiveComponents()

  return updateStateAndRunQueries(true, { parentSpan }).then(() => {
    // 開発中は、ファイルの監視を始めて、クエリをその場で再コンパイルして
    // 実行する。

    // TODO: これを spawn したサービスへ移す
    if (process.env.NODE_ENV !== `production`) {
      watch(store.getState().program.directory)
    }
  })
}
