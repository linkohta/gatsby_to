import _ from "lodash"
import path from "path"
import fs from "fs-extra"
import reporter from "gatsby-cli/lib/reporter"
import { match } from "@gatsbyjs/reach-router"
import { joinPath, md5, slash } from "gatsby-core-utils"
import { store, emitter } from "../redux/"
import { IGatsbyState, IGatsbyPage, IGatsbySlice } from "../redux/types"
import {
  writeModule,
  getAbsolutePathForVirtualModule,
} from "../utils/gatsby-webpack-virtual-modules"
import { getPageMode } from "../utils/page-mode"
import { devSSRWillInvalidate } from "../commands/build-html"
import { rankRoute } from "../utils/rank-route"

const hasContentFilePath = (componentPath: string): boolean =>
  componentPath.includes(`?__contentFilePath=`)

interface IGatsbyPageComponent {
  componentPath: string
  componentChunkName: string
  hasHeadComponent: boolean
}

interface IGatsbyPageMatchPath {
  path: string
  matchPath: string | undefined
}

let lastHash: string | null = null

export const resetLastHash = (): void => {
  lastHash = null
}

type IBareComponentData = Pick<
  IGatsbyPageComponent,
  `componentPath` | `componentChunkName`
> & {
  hasHeadComponent: boolean
}

export const getComponents = (
  pages: Array<IGatsbyPage>,
  slices: IGatsbyState[`slices`],
  components: IGatsbyState[`components`]
): Array<IGatsbyPageComponent> => {
  const pickComponentFields = (
    page: IGatsbyPage | IGatsbySlice
  ): IBareComponentData => {
    return {
      componentPath: page.componentPath,
      componentChunkName: page.componentChunkName,
      hasHeadComponent: components.get(page.componentPath)?.Head ?? false,
    }
  }

  return _.orderBy(
    _.uniqBy(
      _.map([...pages, ...slices.values()], pickComponentFields),
      c => c.componentChunkName
    ),
    c => c.componentChunkName
  )
}

/**
 * すべての動的ルートを取得し、より具体的なものが上に来るように並べ替える
 * コードは @reach/router の match ユーティリティに基づく (https://github.com/reach/router/blob/152aff2352bc62cefc932e1b536de9efde6b64a5/src/lib/utils.js#L224-L254)
 */
const getMatchPaths = (
  pages: Array<IGatsbyPage>
): Array<IGatsbyPageMatchPath> => {
  interface IMatchPathEntry extends IGatsbyPage {
    index: number
    score: number
    matchPath: string
  }

  const createMatchPathEntry = (
    page: IGatsbyPage,
    index: number
  ): IMatchPathEntry => {
    const { matchPath } = page

    if (matchPath === undefined) {
      return reporter.panic(
        `Error: matchPath property is undefined for page ${page.path}, should be a string`
      ) as never
    }

    return {
      ...page,
      matchPath,
      index,
      score: rankRoute(matchPath),
    }
  }

  const matchPathPages: Array<IMatchPathEntry> = []

  pages.forEach((page: IGatsbyPage, index: number): void => {
    if (page.matchPath && getPageMode(page) === `SSG`) {
      matchPathPages.push(createMatchPathEntry(page, index))
    }
  })

  // ページは matchPath の中に存在することがある。追加のネットワークリクエストなしで動作し続けるよう、
  // それらを matchPath に保存する。`@reach/router` のパスの順位付けを使ってパスと matchPath に点数を付け、
  // より具体的なパスが、あまり具体的でないパスより前に来るよう並べ替える。
  // 詳細は https://github.com/gatsbyjs/gatsby/issues/16097 を参照
  // 小さな高速化: matchPath が見つからない場合は走査を省く。
  if (matchPathPages.length) {
    const newMatches: Array<IMatchPathEntry> = []

    pages.forEach((page: IGatsbyPage, index: number): void => {
      const isInsideMatchPath = !!matchPathPages.find(
        pageWithMatchPath =>
          !page.matchPath && match(pageWithMatchPath.matchPath, page.path)
      )

      if (isInsideMatchPath) {
        newMatches.push(
          createMatchPathEntry(
            {
              ...page,
              matchPath: page.path,
            },
            index
          )
        )
      }
    })
    // 新しい一致は既存の検索には関係しないので、後から追加する
    matchPathPages.push(...newMatches)
  }

  return matchPathPages
    .sort((a, b) => {
      // 点数が高いほど、matchPath の具体性が高い
      const order = b.score - a.score
      if (order !== 0) {
        return order
      }

      // 具体性が同じ場合は、パスを辞書順で比較する。ページが作成された順序に
      // かかわらず、順序が決定的になるようにするためである
      return a.matchPath.localeCompare(b.matchPath)
    })
    .map(({ path, matchPath }) => {
      return { path, matchPath }
    })
}

// ページの情報を書き出す。
export const writeAll = async (state: IGatsbyState): Promise<boolean> => {
  const { program, slices } = state
  const pages = [...state.pages.values()]
  const matchPaths = getMatchPaths(pages)
  const components = getComponents(pages, slices, state.components)
  let cleanedSSRVisitedPageComponents: Array<IGatsbyPageComponent> = []

  if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    const ssrVisitedPageComponents = [
      ...(state.visitedPages.get(`server`)?.values() || []),
    ]

    // すでに存在しないページコンポーネントを取り除く。
    cleanedSSRVisitedPageComponents = components.filter(
      c =>
        ssrVisitedPageComponents.some(s => s === c.componentChunkName) ||
        c.componentChunkName.startsWith(`slice---`)
    )
  }

  const newHash = await md5(
    JSON.stringify({
      matchPaths,
      components,
      cleanedSSRVisitedPageComponents,
    })
  )

  if (newHash === lastHash) {
    // 何も変わっていない。ファイルを書き直す必要はない
    return false
  }

  lastHash = newHash

  if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    // アクセスされたページコンポーネントのファイルを同期的に require するファイルを作成する。

    const lazySyncRequires = `exports.ssrComponents = {\n${cleanedSSRVisitedPageComponents
      .map(
        (c: IGatsbyPageComponent): string =>
          `  "${c.componentChunkName}": require("${joinPath(c.componentPath)}")`
      )
      .join(`,\n`)}
  }\n\n`

    writeModule(`$virtual/ssr-sync-requires`, lazySyncRequires)
    // これが実行されると、webpack は無効とマークするはずだが、タイミングの競合が起きることがある
    // そのため、ここでも明示的にフラグを設定する
    devSSRWillInvalidate()
  }

  // コンポーネントと JSON のファイルを同期的に require するファイルを作成する。
  let syncRequires = `
// prefer default export if available
const preferDefault = m => (m && m.default) || m
\n\n`
  syncRequires += `exports.components = {\n${components
    .map(
      (c: IGatsbyPageComponent): string =>
        `  "${c.componentChunkName}": preferDefault(require("${joinPath(
          c.componentPath
        )}"))`
    )
    .join(`,\n`)}
}\n\n`

  // コンポーネントと JSON のファイルを非同期に require するファイルを作成する。
  let asyncRequires = ``

  if (
    process.env.gatsby_executing_command === `develop` ||
    (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_PARTIAL_HYDRATION)
  ) {
    asyncRequires = `exports.components = {\n${components
      .map((c: IGatsbyPageComponent): string => {
        // ディレクトリが変わっても contenthash が同じになるよう、相対的な import パスが必要である
        const relativeComponentPath = path.relative(
          getAbsolutePathForVirtualModule(`$virtual`),
          c.componentPath
        )

        const rqPrefix = hasContentFilePath(relativeComponentPath) ? `&` : `?`

        return `  "${c.componentChunkName}": () => import("${slash(
          `./${relativeComponentPath}`
        )}${rqPrefix}export=default" /* webpackChunkName: "${
          c.componentChunkName
        }" */)`
      })
      .join(`,\n`)}
}\n\n

exports.head = {\n${components
      .map((c: IGatsbyPageComponent): string | undefined => {
        if (!c.hasHeadComponent) {
          return undefined
        }
        // ディレクトリが変わっても contenthash が同じになるよう、相対的な import パスが必要である
        const relativeComponentPath = path.relative(
          getAbsolutePathForVirtualModule(`$virtual`),
          c.componentPath
        )

        const rqPrefix = hasContentFilePath(relativeComponentPath) ? `&` : `?`

        return `  "${c.componentChunkName}": () => import("${slash(
          `./${relativeComponentPath}`
        )}${rqPrefix}export=head" /* webpackChunkName: "${
          c.componentChunkName
        }head" */)`
      })
      .filter(Boolean)
      .join(`,\n`)}
}\n\n`
  } else {
    asyncRequires = `exports.components = {\n${components
      .map((c: IGatsbyPageComponent): string => {
        // ディレクトリが変わっても contenthash が同じになるよう、相対的な import パスが必要である
        const relativeComponentPath = path.relative(
          getAbsolutePathForVirtualModule(`$virtual`),
          c.componentPath
        )
        return `  "${c.componentChunkName}": () => import("${slash(
          `./${relativeComponentPath}`
        )}" /* webpackChunkName: "${c.componentChunkName}" */)`
      })
      .join(`,\n`)}
}\n\n`
  }

  const writeAndMove = (
    virtualFilePath: string,
    file: string,
    data: string
  ): Promise<void> => {
    writeModule(virtualFilePath, data)

    // .cache 内のファイルは、もう webpack のビルドの一部としては使われないが、
    // 他のツールが使うことはある（たとえば `gatsby serve` は、ルーティングの設定のために
    // `match-paths.json` を読む）
    const destination = joinPath(program.directory, `.cache`, file)
    const tmp = `${destination}.${Date.now()}`
    return fs
      .writeFile(tmp, data)
      .then(() => fs.move(tmp, destination, { overwrite: true }))
  }

  await Promise.all([
    writeAndMove(`$virtual/sync-requires.js`, `sync-requires.js`, syncRequires),
    writeAndMove(
      `$virtual/async-requires.js`,
      `async-requires.js`,
      asyncRequires
    ),
    writeAndMove(
      `$virtual/match-paths.json`,
      `match-paths.json`,
      JSON.stringify(matchPaths, null, 4)
    ),
  ])

  return true
}

const debouncedWriteAll = _.debounce(
  async (): Promise<void> => {
    const activity = reporter.activityTimer(`write out requires`, {
      id: `requires-writer`,
    })
    activity.start()
    await writeAll(store.getState())
    activity.end()
  },
  500,
  {
    // "leading" を使うと `writeAll` が 2 回呼ばれることがある。特に、
    // `/__refresh` フックでデータを更新するときに起こる。
    leading: false,
  }
)

/**
 * 必要に応じてファイルを書き直せるよう、CREATE/DELETE_PAGE イベントの
 * 待ち受けを開始する
 */
let listenerStarted = false
export const startListener = (): void => {
  // リスナーは 1 回だけ開始する。
  if (listenerStarted) {
    return
  }
  listenerStarted = true

  if (process.env.GATSBY_EXPERIMENTAL_DEV_SSR) {
    /**
     * 必要に応じてファイルを書き直せるよう、CREATE_SERVER_VISITED_PAGE イベントの
     * 待ち受けを開始する
     */
    emitter.on(`CREATE_SERVER_VISITED_PAGE`, async (): Promise<void> => {
      // このイベントは新規の追加でだけ発生する
      devSSRWillInvalidate()
      reporter.pendingActivity({ id: `requires-writer` })
      debouncedWriteAll()
    })
  }

  emitter.on(`CREATE_PAGE`, (): void => {
    reporter.pendingActivity({ id: `requires-writer` })
    debouncedWriteAll()
  })

  emitter.on(`CREATE_PAGE_END`, (): void => {
    reporter.pendingActivity({ id: `requires-writer` })
    debouncedWriteAll()
  })

  emitter.on(`DELETE_PAGE`, (): void => {
    reporter.pendingActivity({ id: `requires-writer` })
    debouncedWriteAll()
  })

  emitter.on(`DELETE_PAGE_BY_PATH`, (): void => {
    reporter.pendingActivity({ id: `requires-writer` })
    debouncedWriteAll()
  })
}
