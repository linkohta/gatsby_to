// @flow
const reporter = require(`gatsby-cli/lib/reporter`)
const chalk = require(`chalk`)
const _ = require(`lodash`)
const { stripIndent } = require(`common-tags`)
const report = require(`gatsby-cli/lib/reporter`)
const { platform } = require(`os`)
const path = require(`path`)
const { trueCasePathSync } = require(`true-case-path`)
const url = require(`url`)
const { slash } = require(`gatsby-core-utils/path`)
const { createContentDigest } = require(
  `gatsby-core-utils/create-content-digest`
)
const { splitComponentPath } = require(`gatsby-core-utils/parse-component-path`)
const { hasNodeChanged } = require(`../../utils/nodes`)
const { getNode, getDataStore } = require(`../../datastore`)
import { sanitizeNode } from "../../utils/sanitize-node"
const { store } = require(`../index`)
const { validateComponent } = require(`../../utils/validate-component`)
import { nodeSchema } from "../../joi-schemas/joi"
const { generateComponentChunkName } = require(`../../utils/js-chunk-names`)
const { getCommonDir, truncatePath, tooLongSegmentsInPath } = require(
  `../../utils/path`
)
const { applyTrailingSlashOption } = require(`gatsby-page-utils`)
const apiRunnerNode = require(`../../utils/api-runner-node`)
const { getNonGatsbyCodeFrame } = require(`../../utils/stack-trace-utils`)
const { getPageMode } = require(`../../utils/page-mode`)
const normalizePath = require(`../../utils/normalize-path`).default
import { createJobV2FromInternalJob } from "./internal"
import { maybeSendJobToMainProcess } from "../../utils/jobs/worker-messaging"
import { reportOnce } from "../../utils/report-once"
import { wrapNode } from "../../utils/detect-node-mutations"

const isNotTestEnv = process.env.NODE_ENV !== `test`
const isTestEnv = process.env.NODE_ENV === `test`

// コストの高い I/O を避けるために、シャドーイングされたページコンポーネントを選ぶ関数をメモ化する。
// 理想的には、シャドーチェーンにあるファイルに対してファイルシステムの操作があれば、メモ化した値を
// 無効化すべきである。しかし、webpack は現状、develop セッション中のシャドーイングの変更を
// 扱えないので、無効化しなくても致命的ではない。
const shadowCreatePagePath = _.memoize(
  require(
    `../../internal-plugins/webpack-theme-component-shadowing/create-page`
  )
)
const { createInternalJob } = require(`../../utils/jobs/manager`)

const actions = {}
const isWindows = platform() === `win32`

const ensureWindowsDriveIsUppercase = filePath => {
  const segments = filePath.split(`:`).filter(s => s !== ``)
  return segments.length > 0
    ? segments.shift().toUpperCase() + `:` + segments.join(`:`)
    : filePath
}

const findChildren = initialChildren => {
  const children = [...initialChildren]
  const queue = [...initialChildren]
  const traversedNodes = new Set()

  while (queue.length > 0) {
    const currentChild = getNode(queue.pop())
    if (!currentChild || traversedNodes.has(currentChild.id)) {
      continue
    }
    traversedNodes.add(currentChild.id)
    const newChildren = currentChild.children
    if (_.isArray(newChildren) && newChildren.length > 0) {
      children.push(...newChildren)
      queue.push(...newChildren)
    }
  }
  return children
}

import type { Plugin } from "./types"

type Job = {
  id: string,
}

type JobV2 = {
  name: string,
  inputPaths: string[],
  outputDir: string,
  args: Object,
}

export interface IPageInput {
  path: string;
  component: string;
  context?: Object;
  ownerNodeId?: string;
  defer?: boolean;
  slices: Record<string, string>;
}

type PageMode = "SSG" | "DSG" | "SSR"

type Page = {
  path: string,
  matchPath: ?string,
  component: string,
  context: Object,
  internalComponentName: string,
  componentChunkName: string,
  updatedAt: number,
  ownerNodeId?: string,
  mode: PageMode,
  slices: Record<string, string>,
}

type ActionOptions = {
  traceId: ?string,
  parentSpan: ?Object,
  followsSpan: ?Object,
}

type PageData = {
  id: string,
  resultHash: string,
}

type PageDataRemove = {
  id: string,
}

/**
 * ページを削除する
 * @param {Object} page ページオブジェクト
 * @param {string} page.path ページのパス
 * @param {string} page.component ページコンポーネントへの絶対パス
 * @example
 * deletePage(page)
 */
actions.deletePage = (page: IPageInput) => {
  return {
    type: `DELETE_PAGE`,
    payload: page,
  }
}

const hasWarnedForPageComponentInvalidContext = new Set()
const hasWarnedForPageComponentInvalidCasing = new Set()
const hasErroredBecauseOfNodeValidation = new Set()
const pageComponentCache = new Map()
const reservedFields = [
  `path`,
  `matchPath`,
  `component`,
  `componentChunkName`,
  `pluginCreator___NODE`,
  `pluginCreatorId`,
]
/**
 * ページを作成する。ページの作成についての詳しいドキュメントは、[ページの作成と変更のガイド](/docs/creating-and-modifying-pages/)
 * を参照。
 * @param {Object} page ページオブジェクト
 * @param {string} page.path 任意の有効な URL。スラッシュで始まる必要がある。Unicode 文字はエンコードせずにそのまま渡す（例: `á` と書き、`%C3%A1` とは書かない）。
 * @param {string} page.matchPath Reach Router がクライアントサイドでページの照合に使うパス。
 * [matchPath](/docs/gatsby-internals-terminology/#matchpath) のドキュメントも参照
 * @param {string} page.ownerNodeId このページを所有するノードの ID。公開アクション unstable_createNodeManifest を通じて、ユーザーをプレビューへ案内するために使われる。1 つのページで複数のノードをクエリできるので、どのノードがそのページの主となるノードかをユーザーが指定できるようにしている。ownerNodeId は、このページで GraphQL クエリによってクエリされているノードのものでなければならない。
 * @param {string} page.component このページのコンポーネントへの絶対パス
 * @param {Object} page.context このページのコンテキストデータ。props として
 * コンポーネントの `this.props.pageContext` に渡されるほか、graphql クエリにも
 * graphql の引数として渡される。
 * @param {Object} page.slices このページでレンダリングされる Slice の、エイリアスから ID への対応。[Gatsby Slice API](/docs/reference/built-in-components/gatsby-slice) の技術ドキュメントを参照。
 * @param {boolean} page.defer `true` にすると、Gatsby はそのページをビルドのステップから除外し、最初の HTTP リクエストのときに生成する。デフォルト値は `false`。[Deferred Static Generation](/docs/reference/rendering-options/deferred-static-generation/) のドキュメントも参照。
 * @example
 * createPage({
 *   path: `/my-sweet-new-page/`,
 *   component: path.resolve(`./src/templates/my-sweet-new-page.js`),
 *   ownerNodeId: `123456`,
 *   // The context is passed as props to the component as well
 *   // as into the component's GraphQL query.
 *   context: {
 *     id: `123456`,
 *   },
 * })
 */
actions.createPage = (
  page: IPageInput,
  plugin?: Plugin,
  actionOptions?: ActionOptions
) => {
  let name = `The plugin "${plugin.name}"`
  if (plugin.name === `default-site-plugin`) {
    name = `Your site's "gatsby-node.js"`
  }
  if (!page.path) {
    const message = `${name} must set the page path when creating a page`
    // テスト中はログを出さない
    if (isNotTestEnv) {
      report.panic({
        id: `11323`,
        context: {
          pluginName: name,
          pageObject: page,
          message,
        },
      })
    } else {
      return message
    }
  }

  // コンテキストオブジェクトが、コアのページフィールドと重なっていないことを検証する。
  // 重なっていると、graphql クエリの実行時に問題が起きるためである。
  if (page.context && typeof page.context === `object`) {
    const invalidFields = reservedFields.filter(field => field in page.context)

    if (invalidFields.length > 0) {
      const error = `${
        invalidFields.length === 1
          ? `${name} used a reserved field name in the context object when creating a page:`
          : `${name} used reserved field names in the context object when creating a page:`
      }

${invalidFields.map(f => `  * "${f}"`).join(`\n`)}

${JSON.stringify(page, null, 4)}

Data in "context" is passed to GraphQL as potential arguments when running the
page query.

When arguments for GraphQL are constructed, the context object is combined with
the page object so *both* page object and context data are available as
arguments. So you don't need to add the page "path" to the context as it's
already available in GraphQL. If a context field duplicates a field already
used by the page object, this can break functionality within Gatsby so must be
avoided.

Please choose another name for the conflicting fields.

The following fields are used by the page object and should be avoided.

${reservedFields.map(f => `  * "${f}"`).join(`\n`)}

            `
      if (isTestEnv) {
        return error
        // コンテキストの側の値がページの側の値と異なる場合にだけ
        // エラーにする。v1 では、GraphQL で使えるようにするには path をコンテキストにも
        // 渡す必要があると考えた人が多かった
      } else if (invalidFields.some(f => page.context[f] !== page[f])) {
        report.panic({
          id: `11324`,
          context: {
            message: error,
          },
        })
      } else {
        if (!hasWarnedForPageComponentInvalidContext.has(page.component)) {
          report.warn(error)
          hasWarnedForPageComponentInvalidContext.add(page.component)
        }
      }
    }
  }

  // コンポーネントが設定されているかを確認する。
  if (!page.component) {
    if (isNotTestEnv) {
      report.panic({
        id: `11322`,
        context: {
          input: page,
          pluginName: name,
        },
      })
    } else {
      // テスト用
      return `A component must be set when creating a page`
    }
  }

  const pageComponentPath = shadowCreatePagePath(page.component)
  if (pageComponentPath) {
    page.component = pageComponentPath
  }

  const { config, program } = store.getState()
  const { trailingSlash } = config
  const { directory } = program

  const { error, panicOnBuild } = validateComponent({
    input: page,
    pluginName: name,
    errorIdMap: {
      noPath: `11322`,
      notAbsolute: `11326`,
      doesNotExist: `11325`,
      empty: `11327`,
      noDefaultExport: `11328`,
    },
  })

  if (error) {
    if (isNotTestEnv) {
      if (panicOnBuild) {
        report.panicOnBuild(error)
      } else {
        report.panic(error)
      }
    }
    return `${name} must set the absolute path to the page component when creating a page`
  }

  // コストの高い "trueCasePath" の処理を実行する前に、
  // このコンポーネントパスを以前に処理したかを
  // 確認する
  //
  // テスト中は、パスがディスク上に存在しないのでスキップする。
  if (isNotTestEnv) {
    if (pageComponentCache.has(page.component)) {
      page.component = pageComponentCache.get(page.component)
    } else {
      const originalPageComponent = page.component
      const splitPath = splitComponentPath(page.component)

      // コンポーネントパスを正規化する
      page.component = slash(splitPath[0])
      // パスの大文字と小文字が正しいかを確認する。正しくないと、
      // クエリコンパイラーで問題が起きるほか、Mac や Windows で
      // 開発して Linux の CI/CD パイプラインからデプロイしようとしたときに
      // 不整合が起きる
      let trueComponentPath
      try {
        // ほとんどのシステム
        trueComponentPath = slash(trueCasePathSync(page.component))
      } catch (e) {
        // ユーザーが / にアクセスできないシステム
        const commonDir = getCommonDir(directory, page.component)

        // `path.win32` を使って、大文字と小文字を区別しない相対パスを強制する
        const relativePath = slash(
          path.win32.relative(commonDir, page.component)
        )

        trueComponentPath = slash(trueCasePathSync(relativePath, commonDir))
      }

      if (isWindows) {
        page.component = ensureWindowsDriveIsUppercase(page.component)
      }

      if (trueComponentPath !== page.component) {
        if (!hasWarnedForPageComponentInvalidCasing.has(page.component)) {
          const markers = page.component
            .split(``)
            .map((letter, index) => {
              if (letter !== trueComponentPath[index]) {
                return `^`
              }
              return ` `
            })
            .join(``)

          report.warn(
            stripIndent`
          ${name} created a page with a component path that doesn't match the casing of the actual file. This may work locally, but will break on systems which are case-sensitive, e.g. most CI/CD pipelines.

          page.component:     "${page.component}"
          path in filesystem: "${trueComponentPath}"
                               ${markers}
        `
          )
          hasWarnedForPageComponentInvalidCasing.add(page.component)
        }

        page.component = trueComponentPath
      }

      if (splitPath.length > 1) {
        page.component = `${page.component}?__contentFilePath=${splitPath[1]}`
      }

      pageComponentCache.set(originalPageComponent, page.component)
    }
  }

  let internalComponentName
  if (page.path === `/`) {
    internalComponentName = `ComponentIndex`
  } else {
    internalComponentName = `Component${page.path}`
  }

  const invalidPathSegments = tooLongSegmentsInPath(page.path)

  if (invalidPathSegments.length > 0) {
    const truncatedPath = truncatePath(page.path)
    report.warn(
      report.stripIndent(`
        The path to the following page is longer than the supported limit on most
        operating systems and will cause an ENAMETOOLONG error. The path has been
        truncated to prevent this.

        Original Path: ${page.path}

        Truncated Path: ${truncatedPath}
      `)
    )
    page.path = truncatedPath
  }

  page.path = applyTrailingSlashOption(page.path, trailingSlash)

  const internalPage: Page = {
    internalComponentName,
    path: page.path,
    matchPath: page.matchPath,
    component: normalizePath(page.component),
    componentPath: normalizePath(page.component),
    componentChunkName: generateComponentChunkName(page.component),
    isCreatedByStatefulCreatePages:
      actionOptions?.traceId === `initial-createPagesStatefully`,
    // ページがコンテキストオブジェクトを持つようにする
    context: page.context || {},
    updatedAt: Date.now(),
    slices: page?.slices || {},

    // ページをそのプラグインに結び付ける。
    pluginCreator___NODE: plugin.id ?? ``,
    pluginCreatorId: plugin.id ?? ``,
  }

  if (page.defer) {
    internalPage.defer = true
  }
  // 注: mode は、すべてのページコンポーネントにアクセスできるようになったビルドの最後に更新される。
  // utils/page-mode.ts の materializePageMode を参照
  internalPage.mode = getPageMode(internalPage)

  if (page.ownerNodeId) {
    internalPage.ownerNodeId = page.ownerNodeId
  }

  // パスの先頭にスラッシュがなければ追加する。
  if (internalPage.path[0] !== `/`) {
    internalPage.path = `/${internalPage.path}`
  }

  const oldPage: Page = store.getState().pages.get(internalPage.path)
  const contextModified =
    !!oldPage && !_.isEqual(oldPage.context, internalPage.context)
  const componentModified =
    !!oldPage && !_.isEqual(oldPage.component, internalPage.component)
  const slicesModified =
    !!oldPage && !_.isEqual(oldPage.slices, internalPage.slices)

  const alternateSlashPath = page.path.endsWith(`/`)
    ? page.path.slice(0, -1)
    : page.path + `/`

  if (store.getState().pages.has(alternateSlashPath)) {
    report.warn(
      chalk.bold.yellow(`Non-deterministic routing danger: `) +
        `Attempting to create page: "${page.path}", but page "${alternateSlashPath}" already exists\n` +
        chalk.bold.yellow(
          `This could lead to non-deterministic routing behavior`
        )
    )
  }

  // 今のところは createPage アクションクリエイターからコピー＆ペーストしやすくするためだけのもの。理想的には重複をなくしたい
  const { updatedAt, ...node } = internalPage
  node.children = []
  node.internal = {
    type: `SitePage`,
    contentDigest: createContentDigest(node),
  }
  node.id = `SitePage ${internalPage.path}`
  const oldNode = getNode(node.id)

  let deleteActions
  let updateNodeAction
  // createPage を呼ぶプラグインではなく、internal-data-bridge を SitePage の所有者として印を付ける
  if (oldNode && !hasNodeChanged(node.id, node.internal.contentDigest)) {
    updateNodeAction = {
      ...actionOptions,
      plugin: { name: `internal-data-bridge` },
      type: `TOUCH_NODE`,
      typeName: node.internal.type,
      payload: node.id,
    }
  } else {
    // 以前に作成された子孫ノードは、すべて作り直されることになるので、
    // 取り除く。
    if (oldNode) {
      const createDeleteAction = node => {
        return {
          ...actionOptions,
          type: `DELETE_NODE`,
          plugin: { name: `internal-data-bridge` },
          payload: node,
          isRecursiveChildrenDelete: true,
        }
      }
      deleteActions = findChildren(oldNode.children)
        .map(getNode)
        .map(createDeleteAction)
    }

    node.internal.counter = getNextNodeCounter()

    updateNodeAction = {
      ...actionOptions,
      type: `CREATE_NODE`,
      plugin: { name: `internal-data-bridge` },
      oldNode,
      payload: node,
    }
  }

  // シリアライズできないユーザー提供のオブジェクトを後でシリアライズしようとしないように、ページオブジェクトをサニタイズする
  const sanitizedPayload = sanitizeNode(internalPage)

  const actions = [
    {
      ...actionOptions,
      type: `CREATE_PAGE`,
      contextModified,
      componentModified,
      slicesModified,
      plugin,
      payload: sanitizedPayload,
    },
  ]

  if (deleteActions && deleteActions.length) {
    actions.push(...deleteActions)
  }

  actions.push(updateNodeAction)

  return actions
}

/**
 * ノードを削除する
 * @param {object} node ノードオブジェクト。ノードオブジェクトの詳細については "createNode" アクションを参照。
 * @example
 * deleteNode(node)
 */
actions.deleteNode = (node: any, plugin?: Plugin) => {
  const id = node && node.id

  // ノードは常にストアから取得する。引数として受け取ったノードは、
  // すでに削除されているかもしれないためである。
  const internalNode = getNode(id)

  const createDeleteAction = node => {
    return {
      type: `DELETE_NODE`,
      plugin,
      payload: node,
      // 主となるノードは、deleteNode を呼ぶプラグインが所有していなければならない
      // 子ノードは所有権の確認をスキップする
      isRecursiveChildrenDelete: node !== internalNode,
    }
  }

  const deleteAction = createDeleteAction(internalNode)

  // ファイルノードが一度も作成されていないこともありうる。ツールによっては、
  // 一時ファイルをファイルシステムに書き込んですぐに削除することがあるためである。
  const deleteDescendantsActions =
    internalNode &&
    findChildren(internalNode.children).map(getNode).map(createDeleteAction)

  if (deleteDescendantsActions && deleteDescendantsActions.length) {
    return [...deleteDescendantsActions, deleteAction]
  } else {
    return deleteAction
  }
}

// さまざまなノードの部分集合を高速に比較したり積集合を求めたりするために、
// node.internal にカウンターを追加する。カウンターはビルドをまたいでも増え続けなければならない。
function getNextNodeCounter() {
  const lastNodeCounter = store.getState().status.LAST_NODE_COUNTER ?? 0
  if (lastNodeCounter >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Could not create more nodes. Maximum node count is reached: ${lastNodeCounter}`
    )
  }
  return lastNodeCounter + 1
}

// ラッパーではなくこのコードを参照できるように、memberof の記法を追加している。
/**
 * 新しいノードを作成する。
 * @memberof actions
 * @param {Object} node ノードオブジェクト
 * @param {string} node.id ノードの ID。グローバルに一意でなければならない。
 * @param {string} node.parent 親ノードの ID。このノードが別のノードから
 * 派生している場合は、そのノードを親に設定する。そうでなければ
 * `null` でよい。
 * @param {Array} node.children 子ノードの ID の配列。親ノードを作成する
 * ときに子ノードも作成する場合は、子ノードの ID をここに直接
 * 追加する。プラグインが作成した親ノードに子ノードを追加する
 * 場合は、この値を直接変更して自分のノードの ID を追加することは
 * できない。代わりにアクションクリエイター `createParentChildLink` を使う。
 * @param {Object} node.internal ノードのデータを利用する側にとっては
 * 通常は関心がないが、プラグインの作者や Gatsby コアにとっては非常に
 * 有用なノードのフィールド。`internal` オブジェクトに入れられるのは、以下に示すフィールドだけである。
 * 独自のフィールドを使うと、種類を問わずバリデーションエラーになる。
 * @param {string} node.internal.mediaType 省略可能なフィールド。ノードが
 * 変換できる生のコンテンツを持っていることをトランスフォーマープラグインに伝える。
 * 公式のメディアタイプ（情報源として mime-db
 * (https://www.npmjs.com/package/mime-db) を使っている）か、データが
 * 既存のどの分類にも当てはまらない場合は独自に作ったものを使う。トランスフォーマープラグインは、
 * ノードを新しいノードに変換すべきかどうかをノードのメディアタイプで判断する。たとえば
 * markdown のトランスフォーマーは、メディアタイプが
 * `text/markdown` のものを探す。
 * @param {string} node.internal.type ノードを作成するプラグインが選ぶ、
 * グローバルに一意な任意の型。型は GraphQL の型を作るのに使われ、
 * ユーザーはここで選んだ型をもとにノードをクエリするので、
 * ノードの内容を表す名前にすべきである。ある型のノードを作成できるのは、
 * 1 つのプラグインだけである。
 * @param {string} node.internal.content 省略可能なフィールド。使われることは
 * まれである。ソースプラグインが、変換方法の分からないデータ（たとえば
 * API から取得した markdown の文字列）を取得したときに使う。ソースプラグインは、
 * gatsby-transformer-remark のような専用のトランスフォーマープラグインに
 * 変換を任せることができる。この `content` フィールドは生のコンテンツ
 * （markdown の場合は markdown の文字列）を保持する。
 *
 * すでに構造化されているデータは、ノードオブジェクトのトップレベルに
 * 追加すべきであり、ここには追加 _しない_。ノードのデータをここで
 * `JSON.stringify` してはならない。
 *
 * コンテンツが非常に大きく、遅延読み込みができる場合（たとえばディスク上のファイル）は、
 * そのノードに `loadNodeContent` 関数を定義すれば、ノードの
 * コンテンツは必要になったときに遅延読み込みされる。
 * @param {string} node.internal.contentDigest このノードのコンテンツの
 * ダイジェスト。変更されていないデータに対して Gatsby が余分な処理を
 * しないようにするのに役立つ。
 * @param {string} node.internal.description 省略可能なフィールド。この
 * ノードが何を表すか、またはその出どころについての、人が読める説明。
 * 型の衝突が見つかったときに表示され、衝突を見つけて直すのが
 * 楽になる。
 * @param {string} node.internal.contentFilePath 省略可能なフィールド。プラグインは、
 * ノードを作成するときに、コンテンツファイル（たとえば markdown ファイル）への
 * 絶対パスをここに追加できる。例: gatsby-plugin-mdx は、`File` ノードの
 * 絶対パスを `Mdx` ノードの `internal.contentFilePath` に追加する。
 * @returns {Promise} 返される Promise は、`createNode` によって連鎖的に起動された
 * `onCreateNode` API の呼び出しがすべて終わったときに解決される。
 * @example
 * createNode({
 *   // Data for the node.
 *   field1: `a string`,
 *   field2: 10,
 *   field3: true,
 *   ...arbitraryOtherData,
 *
 *   // Required fields.
 *   id: `a-node-id`,
 *   parent: `the-id-of-the-parent-node`, // or null if it's a source node without a parent
 *   children: [],
 *   internal: {
 *     type: `CoolServiceMarkdownField`,
 *     contentDigest: crypto
 *       .createHash(`md5`)
 *       .update(JSON.stringify(fieldData))
 *       .digest(`hex`),
 *     mediaType: `text/markdown`, // optional
 *     content: JSON.stringify(fieldData), // optional
 *     description: `Cool Service: "Title of entry"`, // optional
 *   }
 * })
 */
const createNode = (
  node: any,
  plugin?: Plugin,
  actionOptions?: ActionOptions = {}
) => {
  if (!_.isObject(node)) {
    return console.log(
      chalk.bold.red(
        `The node passed to the "createNode" action creator must be an object`
      )
    )
  }

  // 新しいノードが internal オブジェクトを持つようにする。
  if (!node.internal) {
    node.internal = {}
  }

  // 新しいノードが children 配列を持つようにする。
  if (!node.array && !_.isArray(node.children)) {
    node.children = []
  }

  // 新しいノードが parent フィールドを持つようにする
  if (!node.parent) {
    node.parent = null
  }

  // owner の名前を自分で設定しないようにユーザーへ伝える。
  if (node.internal.owner) {
    report.error(JSON.stringify(node, null, 4))
    report.panic(
      chalk.bold.red(
        `The node internal.owner field is set automatically by Gatsby and not by plugins`
      )
    )
  }

  const trackParams = {}
  // プラグイン名を internal オブジェクトに追加する。
  if (plugin) {
    node.internal.owner = plugin.name
    trackParams[`pluginName`] = `${plugin.name}@${plugin.version}`
  }

  const result = nodeSchema.validate(node)
  if (result.error) {
    if (!hasErroredBecauseOfNodeValidation.has(result.error.message)) {
      const errorObj = {
        id: `11467`,
        context: {
          validationErrorMessage: result.error.message,
          node,
        },
      }

      const possiblyCodeFrame = getNonGatsbyCodeFrame()
      if (possiblyCodeFrame) {
        errorObj.context.codeFrame = possiblyCodeFrame.codeFrame
        errorObj.filePath = possiblyCodeFrame.fileName
        errorObj.location = {
          start: {
            line: possiblyCodeFrame.line,
            column: possiblyCodeFrame.column,
          },
        }
      }

      report.error(errorObj)
      hasErroredBecauseOfNodeValidation.add(result.error.message)
    }

    return { type: `VALIDATION_ERROR`, error: true }
  }

  // ノードが fields を直接設定していないことを確認する。
  if (node.fields) {
    throw new Error(
      stripIndent`
      Plugins creating nodes can not set data on the reserved field "fields"
      as this is reserved for plugins which wish to extend your nodes.

      If your plugin didn't add "fields" you're probably seeing this
      error because you're reusing an old node object.

      Node:

      ${JSON.stringify(node, null, 4)}

      Plugin that created the node:

      ${JSON.stringify(plugin, null, 4)}
    `
    )
  }

  node = sanitizeNode(node)

  const oldNode = getNode(node.id)

  if (actionOptions.parentSpan) {
    actionOptions.parentSpan.setTag(`nodeId`, node.id)
    actionOptions.parentSpan.setTag(`nodeType`, node.id)
  }

  let deleteActions
  let updateNodeAction
  // ノードがすでに処理済みであるかを確認する。
  if (oldNode && !hasNodeChanged(node.id, node.internal.contentDigest)) {
    updateNodeAction = {
      ...actionOptions,
      plugin,
      type: `TOUCH_NODE`,
      payload: node.id,
      typeName: node.internal.type,
    }
  } else {
    // 以前に作成された子孫ノードは、すべて作り直されることになるので、
    // 取り除く。
    if (oldNode) {
      const createDeleteAction = node => {
        return {
          ...actionOptions,
          type: `DELETE_NODE`,
          plugin,
          payload: node,
          isRecursiveChildrenDelete: true,
        }
      }
      deleteActions = findChildren(oldNode.children)
        .map(getNode)
        .map(createDeleteAction)
    }

    node.internal.counter = getNextNodeCounter()

    updateNodeAction = {
      ...actionOptions,
      type: `CREATE_NODE`,
      plugin,
      oldNode,
      payload: node,
    }
  }

  if (deleteActions && deleteActions.length) {
    return [...deleteActions, updateNodeAction]
  } else {
    return updateNodeAction
  }
}

actions.createNode =
  (...args) =>
  dispatch => {
    const actions = createNode(...args)

    dispatch(actions)
    const createNodeAction = (
      Array.isArray(actions) ? actions : [actions]
    ).find(action => action.type === `CREATE_NODE`)

    if (!createNodeAction) {
      return Promise.resolve(undefined)
    }

    const { payload: node, traceId, parentSpan } = createNodeAction
    const maybePromise = apiRunnerNode(`onCreateNode`, {
      node: wrapNode(node),
      traceId,
      parentSpan,
      traceTags: { nodeId: node.id, nodeType: node.internal.type },
    })

    if (maybePromise?.then) {
      return maybePromise.then(res =>
        getDataStore()
          .ready()
          .then(() => res)
      )
    } else {
      return getDataStore()
        .ready()
        .then(() => maybePromise)
    }
  }

/**
 * ノードに「タッチ」する。ノードがまだ存在しており、ガベージコレクションの
 * 対象にすべきでないことを Gatsby に伝える。主に、更新されたノードだけを
 * 返せるリモートシステムからノードを取得するソースプラグインで役に立つ。
 * その場合、ソースプラグインは、更新されていないがまだ存在するすべての
 * ノードにタッチして、それらを残すべきであることを Gatsby に知らせる。
 * @param {Object} node ノードオブジェクト。ノードオブジェクトの詳細については "createNode" アクションを参照。
 * @example
 * touchNode(node)
 */
actions.touchNode = (node: any, plugin?: Plugin) => {
  const nodeId = node?.id

  if (!nodeId) {
    // ノードの ID がなければ、このアクションは dispatch しない
    return []
  }

  return {
    type: `TOUCH_NODE`,
    plugin,
    payload: nodeId,
    typeName: node.internal.type,
  }
}

type CreateNodeInput = {
  node: Object,
  name?: string,
  value: any,
}
/**
 * 別のノードを拡張する。新しいノードフィールドは、拡張されたノード
 * オブジェクトの `fields` キーの下に置かれる。
 *
 * あるプラグインがフィールド名を確保すると、そのフィールド名は他の
 * プラグインからは使えなくなる。また、ノードはイミュータブルなので、ノードを
 * 直接変更することはできない。別のノードを拡張するには、これを使う。
 * @param {Object} $0
 * @param {Object} $0.node 対象のノードオブジェクト
 * @param {string} $0.name フィールドの名前
 * @param {any} $0.value フィールドの値
 * @example
 * createNodeField({
 *   node,
 *   name: `happiness`,
 *   value: `is sweet graphql queries`
 * })
 *
 * // The field value is now accessible at node.fields.happiness
 */
actions.createNodeField = (
  { node, name, value }: CreateNodeInput,
  plugin: Plugin,
  actionOptions?: ActionOptions
) => {
  // 必須のフィールドが設定されていることを確認する。
  if (!node.internal.fieldOwners) {
    node.internal.fieldOwners = {}
  }
  if (!node.fields) {
    node.fields = {}
  }

  // スキーマで使われる、正規化したフィールド名
  const schemaFieldName = _.includes(name, `___NODE`)
    ? name.split(`___`)[0]
    : name

  // このフィールドが別のプラグインに所有されていないことを確認する。
  const fieldOwner = node.internal.fieldOwners[schemaFieldName]
  if (fieldOwner && fieldOwner !== plugin.name) {
    throw new Error(
      stripIndent`
      A plugin tried to update a node field that it doesn't own:

      Node id: ${node.id}
      Plugin: ${plugin.name}
      name: ${name}
      value: ${value}
      `
    )
  }

  // ノードを更新する
  node.fields[name] = value
  node.internal.fieldOwners[schemaFieldName] = plugin.name
  node = sanitizeNode(node)

  return {
    ...actionOptions,
    type: `ADD_FIELD_TO_NODE`,
    plugin,
    payload: node,
    addedField: name,
  }
}

/**
 * 親ノードと子ノードの間のリンクを作成する。ノードのコンテンツを変換して
 * 新しい子ノードを作成するときに使う。新しい子ノードは親の `children` 配列に
 * 追加する必要があるが、イミュータブルな親ノードには直接
 * アクセスできないので、代わりにこのアクションを
 * 使う。
 * @param {Object} $0
 * @param {Object} $0.parent 親のノードオブジェクト
 * @param {Object} $0.child 子のノードオブジェクト
 * @example
 * createParentChildLink({ parent: parentNode, child: childNode })
 */
actions.createParentChildLink = (
  { parent, child }: { parent: any, child: any },
  plugin?: Plugin
) => {
  if (!parent.children.includes(child.id)) {
    parent.children.push(child.id)
  }

  return {
    type: `ADD_CHILD_NODE_TO_PARENT_NODE`,
    plugin,
    payload: parent,
  }
}

/**
 * 追加の設定を現在の webpack の設定にマージする。意図せず壊してしまうのを防ぐために、
 * 一部の設定オプションは、設定されていても無視される。
 * 具体的には、`entry`、`output`、`target`、`resolveLoaders` への変更はすべて無視される。
 *
 * webpack の設定を完全に制御するには、`replaceWebpackConfig()` を使う。
 *
 * @param {Object} config 現在の設定にマージする、webpack の設定の一部
 */
actions.setWebpackConfig = (config: Object, plugin?: ?Plugin = null) => {
  if (config.node?.fs === `empty`) {
    report.warn(
      `[deprecated${
        plugin ? ` ` + plugin.name : ``
      }] node.fs is deprecated. Please set "resolve.fallback.fs = false".`
    )
    delete config.node.fs
    config.resolve = config.resolve || {}
    config.resolve.fallback = config.resolve.fallback || {}
    config.resolve.fallback.fs = false
  }

  return {
    type: `SET_WEBPACK_CONFIG`,
    plugin,
    payload: config,
  }
}

/**
 * 現在のステージの webpack の設定を完全に置き換える。特定の設定オプションを
 * 変更すると Gatsby が壊れることがあり、危険を伴う。
 *
 * 通常は、設定のマージのロジックを自分で扱う必要がある場合にだけ
 * 役に立つ。その場合は `webpack-merge` の利用を検討するとよい。
 *
 * @param {Object} config webpack の設定の全体
 */
actions.replaceWebpackConfig = (config: Object, plugin?: ?Plugin = null) => {
  if (config.node?.fs === `empty`) {
    report.warn(
      `[deprecated${
        plugin ? ` ` + plugin.name : ``
      }] node.fs is deprecated. Please set "resolve.fallback.fs = false".`
    )
    delete config.node.fs
    config.resolve = config.resolve || {}
    config.resolve.fallback = config.resolve.fallback || {}
    config.resolve.fallback.fs = false
  }

  return {
    type: `REPLACE_WEBPACK_CONFIG`,
    plugin,
    payload: config,
  }
}

/**
 * トップレベルの Babel オプションを設定する。プラグインとプリセットは無視される。
 * それらには setBabelPlugin と setBabelPreset を使う。
 * @param {Object} config 通常の babelrc の JavaScript オブジェクトと同じ形のオプションオブジェクト
 * @example
 * setBabelOptions({
 *   options: {
 *     sourceMaps: `inline`,
 *   }
 * })
 */
actions.setBabelOptions = (options: Object, plugin?: ?Plugin = null) => {
  // 検証する
  let name = `The plugin "${plugin.name}"`
  if (plugin.name === `default-site-plugin`) {
    name = `Your site's "gatsby-node.js"`
  }
  if (!_.isObject(options)) {
    console.log(`${name} must pass an object to "setBabelOptions"`)
    console.log(JSON.stringify(options, null, 4))
    if (isNotTestEnv) {
      process.exit(1)
    }
  }

  if (!_.isObject(options.options)) {
    console.log(`${name} must pass options to "setBabelOptions"`)
    console.log(JSON.stringify(options, null, 4))
    if (isNotTestEnv) {
      process.exit(1)
    }
  }

  return {
    type: `SET_BABEL_OPTIONS`,
    plugin,
    payload: options,
  }
}

/**
 * 新しいプラグインを追加するか、既存の Babel プラグインにオプションをマージする。
 * @param {Object} config 追加する Babel プラグインを表す設定オブジェクト。
 * @param {string} config.name Babel プラグインの名前
 * @param {Object} config.options Babel プラグインに渡すオプション。
 * @example
 * setBabelPlugin({
 *   name:  `@emotion/babel-plugin`,
 *   options: {
 *     sourceMap: true,
 *   },
 * })
 */
actions.setBabelPlugin = (config: Object, plugin?: ?Plugin = null) => {
  // 検証する
  let name = `The plugin "${plugin.name}"`
  if (plugin.name === `default-site-plugin`) {
    name = `Your site's "gatsby-node.js"`
  }
  if (!config.name) {
    console.log(`${name} must set the name of the Babel plugin`)
    console.log(JSON.stringify(config, null, 4))
    if (isNotTestEnv) {
      process.exit(1)
    }
  }
  if (!config.options) {
    config.options = {}
  }
  return {
    type: `SET_BABEL_PLUGIN`,
    plugin,
    payload: config,
  }
}

/**
 * 新しいプリセットを追加するか、既存の Babel プリセットにオプションをマージする。
 * @param {Object} config 追加する Babel プラグインを表す設定オブジェクト。
 * @param {string} config.name Babel プリセットの名前。
 * @param {Object} config.options Babel プリセットに渡すオプション。
 * @example
 * setBabelPreset({
 *   name: `@babel/preset-react`,
 *   options: {
 *     pragma: `Glamor.createElement`,
 *   },
 * })
 */
actions.setBabelPreset = (config: Object, plugin?: ?Plugin = null) => {
  // 検証する
  let name = `The plugin "${plugin.name}"`
  if (plugin.name === `default-site-plugin`) {
    name = `Your site's "gatsby-node.js"`
  }
  if (!config.name) {
    console.log(`${name} must set the name of the Babel preset`)
    console.log(JSON.stringify(config, null, 4))
    if (isNotTestEnv) {
      process.exit(1)
    }
  }
  if (!config.options) {
    config.options = {}
  }
  return {
    type: `SET_BABEL_PRESET`,
    plugin,
    payload: config,
  }
}

/**
 * 非推奨。代わりに createJobV2 を使うこと。
 *
 * 「ジョブ」を作成する。ジョブは長時間かかる処理で、通常は
 * GraphQL クエリの副作用として開始される。
 * たとえば [`gatsby-plugin-sharp`](/plugins/gatsby-plugin-sharp/) が
 * これを使っている。
 *
 * Gatsby は、すべてのジョブが終了するまでプロセスを終了しない。
 * @param {Object} job 少なくとも id が設定されたジョブオブジェクト
 * @param {id} job.id ジョブの ID
 * @deprecated 代わりに "createJobV2" を使うこと
 * @example
 * createJob({ id: `write file id: 123`, fileName: `something.jpeg` })
 */
actions.createJob = (job: Job, plugin?: ?Plugin = null) => {
  let msg = `Action "createJob" is deprecated. Please use "createJobV2" instead`

  if (plugin?.name) {
    msg = msg + ` (called by ${plugin.name})`
  }
  reportOnce(msg)

  return {
    type: `CREATE_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * 「ジョブ」を作成する。ジョブは長時間かかる処理で、通常は
 * GraphQL クエリの副作用として開始される。
 * たとえば [`gatsby-plugin-sharp`](/plugins/gatsby-plugin-sharp/) が
 * これを使っている。
 *
 * Gatsby は、すべてのジョブが終了するまでプロセスを終了しない。
 * @param {Object} job name、inputPaths、outputDir、args を持つジョブオブジェクト
 * @param {string} job.name 実行したいジョブの名前
 * @param {string[]} job.inputPaths 実行に必要な inputPaths
 * @param {string} job.outputDir すべてのファイルの保存先になるディレクトリ
 * @param {Object} job.args ジョブの実行に必要な引数
 * @returns {Promise<object>} ジョブの実行が終わったかを確認するための Promise
 * @example
 * createJobV2({ name: `IMAGE_PROCESSING`, inputPaths: [`something.jpeg`], outputDir: `public/static`, args: { width: 100, height: 100 } })
 */
actions.createJobV2 = (job: JobV2, plugin: Plugin) => (dispatch, getState) => {
  const internalJob = createInternalJob(job, plugin)

  const maybeWorkerPromise = maybeSendJobToMainProcess(internalJob)
  if (maybeWorkerPromise) {
    return maybeWorkerPromise
  }

  return createJobV2FromInternalJob(internalJob)(dispatch, getState)
}

actions.addGatsbyImageSourceUrl = (sourceUrl: string) => {
  return {
    type: `PROCESS_GATSBY_IMAGE_SOURCE_URL`,
    payload: { sourceUrl },
  }
}

/**
 * 非推奨。代わりに createJobV2 を使うこと。
 *
 * 「ジョブ」を設定（更新）する。非常に長時間かかるジョブでは、
 * 途中経過に合わせてジョブを更新したいことがある。
 *
 * @param {Object} job 少なくとも id が設定されたジョブオブジェクト
 * @param {id} job.id ジョブの ID
 * @deprecated 代わりに "createJobV2" を使うこと
 * @example
 * setJob({ id: `write file id: 123`, progress: 50 })
 */
actions.setJob = (job: Job, plugin?: ?Plugin = null) => {
  let msg = `Action "setJob" is deprecated. Please use "createJobV2" instead`

  if (plugin?.name) {
    msg = msg + ` (called by ${plugin.name})`
  }
  reportOnce(msg)

  return {
    type: `SET_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * 非推奨。代わりに createJobV2 を使うこと。
 *
 * 「ジョブ」を終了する。
 *
 * Gatsby は、すべてのジョブが終了するまでプロセスを終了しない。
 * @param {Object} job  少なくとも id が設定されたジョブオブジェクト
 * @param {id} job.id ジョブの ID
 * @deprecated 代わりに "createJobV2" を使うこと
 * @example
 * endJob({ id: `write file id: 123` })
 */
actions.endJob = (job: Job, plugin?: ?Plugin = null) => {
  let msg = `Action "endJob" is deprecated. Please use "createJobV2" instead`

  if (plugin?.name) {
    msg = msg + ` (called by ${plugin.name})`
  }
  reportOnce(msg)

  return {
    type: `END_JOB`,
    plugin,
    payload: job,
  }
}

/**
 * プラグインのステータスを設定する。プラグインはこれを使って、最後に何かを取得した
 * 時刻などのステータスのキーを保存できる。これらの値は Gatsby の実行をまたいで永続化される。
 *
 * @param {Object} status  任意の値を設定したオブジェクト
 * @example
 * setPluginStatus({ lastFetched: Date.now() })
 */
actions.setPluginStatus = (
  status: { [key: string]: mixed },
  plugin: Plugin
) => {
  return {
    type: `SET_PLUGIN_STATUS`,
    plugin,
    payload: status,
  }
}

// パスが絶対パスであるかを確認し、そうでなければ先頭に pathPrefix を付ける
const maybeAddPathPrefix = (path, pathPrefix) => {
  const parsed = url.parse(path)
  const isRelativeProtocol = path.startsWith(`//`)
  return `${
    parsed.protocol != null || isRelativeProtocol ? `` : pathPrefix
  }${path}`
}

/**
 * あるページから別のページへのリダイレクトを作成する。
 *
 * リダイレクトは、デプロイ先のプラットフォーム（Gatsby Cloud、Netlify など）で実装されている必要がある。そのために [アダプター](/docs/how-to/previews-deploys-hosting/adapters/) やプラグインを使える。あるいは、[gatsby-plugin-meta-redirect](/plugins/gatsby-plugin-meta-redirect/) を使って、meta リダイレクトの HTML ファイルを生成すれば、任意の静的ファイルホスティングでリダイレクトできる。
 *
 * Netlify でリダイレクトがどのように実装されているかは、[gatsby-adapter-netlify](https://github.com/gatsbyjs/gatsby/tree/master/packages/gatsby-adapter-netlify) のソースコードで確認できる。Gatsby Cloud でも、リダイレクトは追加の設定なしで動く。
 *
 * リダイレクトの設定は、[Gatsby Config API](/docs/reference/config-files/gatsby-config/#trailingslash) の末尾のスラッシュの設定と一致させておくこと。
 *
 * @param {Object} redirect リダイレクトのデータ
 * @param {string} redirect.fromPath 任意の有効な URL。スラッシュで始まる必要がある
 * @param {boolean} redirect.isPermanent 恒久的なリダイレクトにする。デフォルトは一時的なリダイレクト
 * @param {string} redirect.toPath 作成済みのページの URL（`createPage` を参照）
 * @param {boolean} redirect.redirectInBrowser リダイレクトは通常、古い URL をサーバー側で新しい構成へ転送するためのものである。何らかの理由で UI を更新できない場合は、`redirectInBrowser` を true にすると、Gatsby がクライアント側でもリダイレクトを処理する。これが必要になることはほとんどないので、有効にする前に用途に合っているかを確認すること。
 * @param {boolean} redirect.force （プラグイン固有）`fromPath` がコンテンツに一致する場合でもリダイレクトを発生させる。これは Gatsby の API の一部ではなく、ホスティングプロバイダーのリダイレクトを設定する（一部の）プラグインが実装している
 * @param {number} redirect.statusCode （プラグイン固有）HTTP ステータスコードを手動で設定する。これにより、リライト（ステータスコード 200）や独自のエラーページ（ステータスコード 404）を作成できる。同じくステータスコードを設定する `isPermanent` オプションよりも優先されることに注意。これは Gatsby の API の一部ではなく、ホスティングプロバイダーのリダイレクトを設定する（一部の）プラグインが実装している
 * @param {boolean} redirect.ignoreCase （プラグイン固有）リダイレクトを探すときに大文字と小文字を区別しない
 * @param {Object} redirect.conditions 国または言語に基づくリダイレクトを指定する
 * @param {(string|string[])} redirect.conditions.country regional indicator symbol に基づく 2 文字の国コード
 * @param {(string|string[])} redirect.conditions.language ISO 639-1 で定義された 2 文字の識別子
 * @example
 * // Generally you create redirects while creating pages.
 * exports.createPages = ({ graphql, actions }) => {
 *   const { createRedirect } = actions
 *
 *   createRedirect({ fromPath: '/old-url/', toPath: '/new-url/', isPermanent: true })
 *   createRedirect({ fromPath: '/url/', toPath: '/zn-CH/url/', conditions: { language: 'zn' }})
 *   createRedirect({ fromPath: '/url/', toPath: '/en/url/', conditions: { language: ['ca', 'us'] }})
 *   createRedirect({ fromPath: '/url/', toPath: '/ca/url/', conditions: { country: 'ca' }})
 *   createRedirect({ fromPath: '/url/', toPath: '/en/url/', conditions: { country: ['ca', 'us'] }})
 *   createRedirect({ fromPath: '/not_so-pretty_url/', toPath: '/pretty/url/', statusCode: 200 })
 *
 *   // Create pages here
 * }
 */
actions.createRedirect = ({
  fromPath,
  isPermanent = false,
  redirectInBrowser = false,
  toPath,
  ignoreCase = true,
  ...rest
}) => {
  let pathPrefix = ``
  if (store.getState().program.prefixPaths) {
    pathPrefix = store.getState().config.pathPrefix
  }

  return {
    type: `CREATE_REDIRECT`,
    payload: {
      fromPath: maybeAddPathPrefix(fromPath, pathPrefix),
      isPermanent,
      ignoreCase,
      redirectInBrowser,
      toPath: maybeAddPathPrefix(toPath, pathPrefix),
      ...rest,
    },
  }
}

/**
 * ページとデータの間の依存を作成する。
 *
 * @param {Object} $0
 * @param {string} $0.path ページへのパス
 * @param {string} $0.nodeId ノードの ID
 * @param {string} $0.connection connection の型
 * @private
 */
actions.createPageDependency = (
  {
    path,
    nodeId,
    connection,
  }: { path: string, nodeId: string, connection: string },
  plugin: string = ``
) => {
  console.warn(
    `Calling "createPageDependency" directly from actions in deprecated. Use "createPageDependency" from "gatsby/dist/redux/actions/add-page-dependency".`
  )
  return {
    type: `CREATE_COMPONENT_DEPENDENCY`,
    plugin,
    payload: [
      {
        path,
        nodeId,
        connection,
      },
    ],
  }
}

/**
 * ページがサーバーで訪問されたことを記録する。
 *
 * @param {Object} $0
 * @param {string} $0.id ページコンポーネントの chunkName。
 */
actions.createServerVisitedPage = (chunkName: string) => {
  if (store.getState().visitedPages.get(`server`)?.has(chunkName)) {
    // このチャンクはすでに追跡しているので、余分な処理を発生させないように
    // `CREATE_SERVER_VISITED_PAGE` アクションは発行しない
    return []
  }

  return {
    type: `CREATE_SERVER_VISITED_PAGE`,
    payload: { componentChunkName: chunkName },
  }
}

/**
 * 個別のノードマニフェストを作成する。
 * ノードマニフェストが処理されるときに、データソース内のその時点での一意なリビジョンの状態を、渡されたノードから生成されるページに結び付けるために使う。
 *
 * @param {Object} manifest マニフェストのデータ
 * @param {string} manifest.manifestId このマニフェストの一意なリビジョンの状態を、データソースの一意なリビジョンの状態に結び付ける ID。
 * @param {Object} manifest.node manifestId を結び付ける Gatsby のノード。ノードオブジェクトの詳細については "createNode" アクションを参照。
 * @param {string} manifest.updatedAtUTC （省略可能）ノードが最後に更新された時刻。この引数を省略すると、呼び出されたすべてのノードについてマニフェストが作成される。デフォルトでは、過去 30 日以内に更新されたコンテンツについてノードマニフェストが作成される。これを変更するには、環境変数 `NODE_MANIFEST_MAX_DAYS_OLD` を設定する。
 * @example
 * unstable_createNodeManifest({
 *   manifestId: `post-id-1--updated-53154315`,
 *   updatedAtUTC: `2021-07-08T21:52:28.791+01:00`,
 *   node: {
 *      id: `post-id-1`
 *   },
 * })
 */
actions.unstable_createNodeManifest = (
  { manifestId, node, updatedAtUTC },
  plugin: Plugin
) => {
  return {
    type: `CREATE_NODE_MANIFEST`,
    payload: {
      manifestId,
      node,
      pluginName: plugin.name,
      updatedAtUTC,
    },
  }
}

/**
 * ソースプラグインを「ステートフル」として印を付け、タッチされなかったノードの自動削除を無効にする。ステートフルなソースプラグインは、Gatsby による古いノードの確認に頼らずに、自分のノードの削除を自分で管理する。
 * ノードの削除を自分で管理するソースプラグインでは、これを有効にするとパフォーマンスが大きく改善する。ソースプラグインが必要とするメモリーの総量も減る。
 * このアクションを使うときは、先に `hasFeature('stateful-source-nodes')` で対応しているかを確認すること。`hasFeature` は `gatsby-plugin-utils` から export されている。
 *
 * @example
 * import { hasFeature } from "gatsby-plugin-utils"
 *
 * exports.sourceNodes = ({ actions }) => {
 *    if (hasFeature(`stateful-source-nodes`)) {
 *      actions.enableStatefulSourceNodes()
 *    } else {
 *     // fallback to old behavior where all nodes are iterated on and touchNode is called.
 *    }
 * }
 *
 * @param {void} $0
 */
actions.enableStatefulSourceNodes = (plugin: Plugin) => {
  return {
    type: `ENABLE_STATEFUL_SOURCE_PLUGIN`,
    plugin,
  }
}

/**
 * 指定したドメインのリクエストヘッダーを保存し、後で Image CDN（や、場合によっては他の機能）のリクエストを行うときに使えるようにする。
 *
 * @param {Object} $0
 * @param {string} $0.domain ヘッダーを保存する対象のドメイン。
 * @param {Object} $0.headers 保存するヘッダー。
 */
actions.setRequestHeaders = ({ domain, headers }, plugin: Plugin) => {
  const headersIsObject =
    typeof headers === `object` && headers !== null && !Array.isArray(headers)

  const noHeaders = !headersIsObject
  const noDomain = typeof domain !== `string`

  if (noHeaders) {
    reporter.warn(
      `Plugin ${plugin.name} called actions.setRequestHeaders with a headers property that isn't an object.`
    )
  }

  if (noDomain) {
    reporter.warn(
      `Plugin ${plugin.name} called actions.setRequestHeaders with a domain property that isn't a string.`
    )
  }

  if (noDomain || noHeaders) {
    reporter.panic(
      `Plugin ${plugin.name} attempted to set request headers with invalid arguments. See above warnings for more info.`
    )

    return null
  }

  const baseDomain = url.parse(domain)?.hostname

  if (baseDomain) {
    return {
      type: `SET_REQUEST_HEADERS`,
      payload: {
        domain: baseDomain,
        headers,
      },
    }
  } else {
    reporter.panic(
      `Plugin ${plugin.name} attempted to set request headers for a domain that is not a valid URL. (${domain})`
    )

    return null
  }
}

module.exports = { actions }
