import type { ErrorId } from "gatsby-cli/lib/structured-errors/error-map"
import { getNode } from "./../datastore"
import { IGatsbyNode, IGatsbyPage, INodeManifest } from "./../redux/types"
import reporter from "gatsby-cli/lib/reporter"
import { store } from "../redux/"
import { internalActions } from "../redux/actions"
import path from "path"
import fs from "fs-extra"
import fastq from "fastq"

interface INodeManifestPage {
  path?: string
}

/**
 * これは、公開アクション unstable_createNodeManifest の呼び出しを処理した後の出力である
 */
interface INodeManifestOut {
  page: INodeManifestPage
  node: {
    id: string
  }
  foundPageBy: FoundPageBy
}

type FoundPageBy =
  | `ownerNodeId`
  | `filesystem-route-api`
  // この 3 つについては、代わりに ownerNodeId を使うよう警告する
  | `context.id`
  | `context.slug`
  | `queryTracking`
  | `none`

type PreviouslyWrittenNodeManifests = Map<string, Promise<INodeManifestOut>>

function getNodeManifestFileLimit(): number {
  const defaultLimit = 10000

  const overrideLimit =
    process.env.NODE_MANIFEST_FILE_LIMIT &&
    Number(process.env.NODE_MANIFEST_FILE_LIMIT)

  return overrideLimit || defaultLimit
}
/**
 * これは、ディスクに書き出すノードマニフェストファイルの数の上限を定義する
 */
const NODE_MANIFEST_FILE_LIMIT = getNodeManifestFileLimit()

/**
 * nodeId で、またはフォールバックとして node.slug で、最終的にビルドされたページを探す。
 *
 * この関数は `gatsby develop` では正しく動かないことに注意。
 * develop は、ページを作成するときにすべてのページクエリを実行しなくなったためである。
 * 正しいページを探すために、ノード ID からクエリへの対応付けを使っているが、
 * この対応付けは、ブラウザーでページを訪問して初めて作られる。
 * この関数がプレビューへのルーティングに使われるとき、ユーザーはまだ
 * ブラウザーでそのページを訪問しているとは限らない。
 */
async function findPageOwnedByNode({
  nodeId,
  fullNode,
  slug,
}: {
  nodeId: string
  fullNode: IGatsbyNode
  slug?: string
}): Promise<{
  page: INodeManifestPage
  foundPageBy: FoundPageBy
}> {
  const state = store.getState()
  const { pages, staticQueryComponents } = state
  const { byNode, byConnection, trackedComponents } = state.queries

  const nodeType = fullNode?.internal?.type

  const firstPagePathWithNodeAsDataDependency =
    // ノード ID からページクエリのパスへの追跡で、最初に見つかったページ
    byNode?.get(nodeId)?.values()?.next()?.value

  const firstPagePathWithNodeInGraphQLListField =
    // このノードの型の一覧をクエリしている最初のページ。
    // 現状では、connection フィールドについて、ノード ID の一覧とクエリの対応は保存していない。
    // connection の GraphQL の型名に対応付けて、クエリの ID またはページのパスだけを保存している。
    byConnection?.get(nodeType)?.values()?.next()?.value

  let pagePath =
    firstPagePathWithNodeAsDataDependency ||
    firstPagePathWithNodeInGraphQLListField

  // 静的クエリの場合は、その静的クエリを使っている最初のページしか見つけられない
  // ここで `sq--` が見つかるのは、（上の）byConnection がページのパスまたは静的クエリの ID（`sq--` で始まる）を返しうるためである
  if (pagePath?.startsWith(`sq--`)) {
    const staticQueryComponentPath =
      staticQueryComponents?.get(pagePath)?.componentPath

    const firstPagePathUsingStaticQueryComponent: string | null =
      staticQueryComponentPath
        ? trackedComponents
            ?.get(staticQueryComponentPath)
            ?.pages?.values()
            ?.next()?.value
        : null

    pagePath = firstPagePathUsingStaticQueryComponent
  }

  let foundPageBy: FoundPageBy = pagePath ? `queryTracking` : `none`

  if (pages) {
    let ownerPagePath: string | undefined
    let foundOwnerNodeId = false

    // この nodeId がクエリされているそれぞれのページについて
    for (const pageObject of pages.values()) {
      // この nodeId が page.ownerNodeId に設定されたページを
      // まだ見つけていない場合は、このロジックを実行する。
      // この条件が ownerPagePath ではなく foundOwnerNodeId に対するものになっているのは、
      // page.context.id/context.slug に nodeId を持つページを先に見つけ、
      // ループの後のほうで、この nodeId が page.ownerNodeId に設定された
      // ページが出てくる場合があるためである。
      // context.id/context.slug よりも、常に ownerPagePath を優先したい
      if (foundOwnerNodeId) {
        break
      }

      const path = pageObject.path

      const fullPage: IGatsbyPage | undefined = pages.get(path)

      foundOwnerNodeId = fullPage?.ownerNodeId === nodeId

      const foundPageIdInContext = fullPage?.context?.id === nodeId

      // GraphQL クエリで node.slug を使ってクエリするのは十分に一般的なので、ownerNodeId、ファイルシステムのルート、context.id の後のフォールバックとして検索できる
      const foundPageSlugInContext = slug && fullPage?.context?.slug === slug

      if (foundOwnerNodeId) {
        foundPageBy = `ownerNodeId`
      } else if (foundPageIdInContext && fullPage) {
        const pageCreatedByPluginName = getNode(fullPage.pluginCreatorId)?.name

        const pageCreatedByFilesystemPlugin =
          pageCreatedByPluginName === `gatsby-plugin-page-creator`

        foundPageBy = pageCreatedByFilesystemPlugin
          ? `filesystem-route-api`
          : `context.id`
      } else if (foundPageSlugInContext && fullPage) {
        foundPageBy = `context.slug`
      }

      if (
        fullPage &&
        // 最初に、ページの ownerNodeId を確認する。これが
        // 事実上の所有者である。これ以上具体的なものはない
        (foundOwnerNodeId ||
          // 所有者が指定されていない場合は、pageContext に、nodeId と
          // 一致する `id` 変数があるかを調べる。クエリで変数として "id" を
          // 使うのは一般的であり、所有者がない場合は、このノード ID に
          // 対応付けられたページクエリのうち最初に見つかったものを取るよりも、
          // こちらのほうが所有者の推測として優れている。
          // これにより、ファイルシステムのルート API でも、その API を
          // 変更することなく動くようになる。
          foundPageIdInContext ||
          foundPageSlugInContext)
      ) {
        // マニフェストで使うために、このパスを保存する
        ownerPagePath = fullPage.path
      }
    }

    if (ownerPagePath) {
      pagePath = ownerPagePath
    }
  }

  return {
    page: {
      path: pagePath || null,
    },
    foundPageBy,
  }
}

// これらの ID は、次のファイルのエラー ID に対応する
// packages/gatsby-cli/src/structured-errors/error-map.ts
export const foundPageByToLogIds = {
  none: `11801`,
  [`context.id`]: `11802`,
  [`context.slug`]: `11805`,
  queryTracking: `11803`,
  [`filesystem-route-api`]: `success`,
  ownerNodeId: `success`,
}

/**
 * ノードマニフェストについての情報と、それに対して見つかった（または見つからなかった）ページを受け取り、警告を出して、その警告の文字列を返す
 */
export function warnAboutNodeManifestMappingProblems({
  inputManifest,
  pagePath,
  foundPageBy,
  verbose,
}: {
  inputManifest: INodeManifest
  pagePath?: string
  foundPageBy: FoundPageBy
  verbose: boolean
}): { logId: string } {
  let logId: ErrorId | `success`

  switch (foundPageBy) {
    case `none`:
    case `context.id`:
    case `context.slug`:
    case `queryTracking`: {
      logId = foundPageByToLogIds[foundPageBy]
      if (verbose) {
        reporter.error({
          id: logId,
          context: {
            inputManifest,
            pagePath,
          },
        })
      }
      break
    }

    case `filesystem-route-api`:
    case `ownerNodeId`:
      logId = `success`
      break

    default: {
      throw Error(`Node Manifest mapping is in an impossible state`)
    }
  }

  return {
    logId,
  }
}

/**
 * プレビューへのルーティングに使う個別のノードマニフェストファイルを準備して、書き出す。マニフェストファイルは、公開アクション unstable_createNodeManifest で追加される
 */
export async function processNodeManifest(
  inputManifest: INodeManifest,
  listOfUniqueErrorIds: Set<string>,
  nodeManifestPagePathMap: Map<string, string>,
  verboseLogs: boolean,
  previouslyWrittenNodeManifests: PreviouslyWrittenNodeManifests
): Promise<null | INodeManifestOut> {
  const nodeId = inputManifest.node.id
  const fullNode = getNode(nodeId)
  const noNodeWarningId = `11804`

  if (!fullNode) {
    if (verboseLogs) {
      reporter.error({
        id: noNodeWarningId,
        context: {
          pluginName: inputManifest.pluginName,
          nodeId,
        },
      })
    } else {
      listOfUniqueErrorIds.add(noNodeWarningId)
    }

    return null
  }

  // ノードを、作成されたページに対応付ける
  const { page: nodeManifestPage, foundPageBy } = await findPageOwnedByNode({
    nodeId,
    fullNode,
    // GraphQL クエリで node.slug を使ってクエリするのは十分に一般的なので、ownerNodeId、ファイルシステムのルート、context.id の後のフォールバックとして検索できる
    slug: fullNode?.slug as string,
  })

  const nodeManifestMappingProblemsContext = {
    inputManifest,
    pagePath: nodeManifestPage.path,
    foundPageBy,
    verbose: verboseLogs,
  }

  if (verboseLogs) {
    warnAboutNodeManifestMappingProblems(nodeManifestMappingProblemsContext)
  } else {
    const { logId } = warnAboutNodeManifestMappingProblems(
      nodeManifestMappingProblemsContext
    )

    if (logId !== `success`) {
      listOfUniqueErrorIds.add(logId)
    }
  }

  const finalManifest: INodeManifestOut = {
    node: inputManifest.node,
    page: nodeManifestPage,
    foundPageBy,
  }

  const gatsbySiteDirectory = store.getState().program.directory

  let fileNameBase = inputManifest.manifestId

  /**
   * Windows には、ファイルパスで使えない特殊文字や予約文字がいくつかある
   * @reference https://superuser.com/questions/358855/what-characters-are-safe-in-cross-platform-file-names-for-linux-windows-and-os
   *
   * 上のリンク先の一覧に対する 2 つの例外は次のとおり
   * - ファイルパスの先頭にある、ハードディスクのパーティション名の一部であるコロン（つまり C:）
   * - バックスラッシュ。バックスラッシュは実際のファイルパスの区切りに使われるので、置き換えたくない
   *
   * ローカルでの開発中、ノードマニフェストはディスクに書き出されることがあるが、通常は使われない。Gatsby Cloud で動く
   * Content Sync でしか使われないためである。Gatsby Cloud は Linux 環境であり、これらの特殊文字は
   * ファイルパスで有効である。Windows でのエラーを避けるために、ファイルパスの中の特殊文字を（ハードディスクの
   * パーティション名を除いて）すべて "-" に置き換え、ローカルの Windows の開発環境が、これらのマニフェストを
   * ディスクに書き出そうとしたときに壊れないようにする。
   */
  if (process.platform === `win32`) {
    fileNameBase = fileNameBase.replace(/:|\/|\*|\?|"|<|>|\||\\/g, `-`)
  }

  // マニフェストファイルを書き出す
  const manifestFilePath = path.join(
    gatsbySiteDirectory,
    `public`,
    `__node-manifests`,
    inputManifest.pluginName,
    `${fileNameBase}.json`
  )

  const manifestFileDir = path.dirname(manifestFilePath)

  await fs.ensureDir(manifestFileDir)

  const previouslyWrittenNodeManifest =
    await previouslyWrittenNodeManifests.get(inputManifest.manifestId)

  // この ID のマニフェストがまだ書き出されていない場合、または書き出し済みのものを、
  // ページが見つかったマニフェストで置き換えられる場合に、マニフェストを書き出す
  // NOTE: foundPageBy が "none" であっても、マニフェストは書き出したい。エラーメッセージの表示に役立つためである
  //       ただし、foundPageBy が "none" ではないマニフェストを書き出すほうを優先する
  const shouldWriteManifest =
    !previouslyWrittenNodeManifest ||
    (previouslyWrittenNodeManifest?.foundPageBy === `none` &&
      finalManifest.foundPageBy !== `none`)

  if (shouldWriteManifest) {
    const writePromise = fs.writeJSON(manifestFilePath, finalManifest)

    // これにより、2 つのマニフェストが同時に同じファイルへ書き込むのを防ぐ
    previouslyWrittenNodeManifests.set(
      inputManifest.manifestId,
      new Promise(resolve => {
        writePromise.then(() => {
          resolve(finalManifest)
        })
      })
    )

    await writePromise
  }

  if (shouldWriteManifest && verboseLogs) {
    reporter.info(
      `Plugin ${inputManifest.pluginName} created a manifest with the id ${fileNameBase}`
    )
  } else if (verboseLogs) {
    reporter.info(
      `Plugin ${inputManifest.pluginName} created a manifest with the id ${fileNameBase} but it was not written to disk because it was already written to disk previously.`
    )
  }

  if (nodeManifestPage.path) {
    nodeManifestPagePathMap.set(nodeManifestPage.path, fileNameBase)
  }

  return finalManifest
}

function nodeManifestSortComparerAscendingUpdatedAt(a, b): number {
  /**
   * updatedAtUTC を持つノードマニフェストを優先し、最も新しいと分かっている
   * マニフェストが先にディスクへ書き出されるようにする。どちらも updatedAtUTC を
   * 持たない場合は、並べ替えるものがない
   */
  if (!a.updatedAtUTC && !b.updatedAtUTC) {
    return 0
  }

  if (!a.updatedAtUTC) {
    return 1
  }

  if (!b.updatedAtUTC) {
    return -1
  }

  return Date.parse(a.updatedAtUTC) - Date.parse(b.updatedAtUTC)
}

/**
 * 保留中のすべてのノードマニフェストを取得して処理し、ディスクに書き出した後、
 * ストアから取り除く。
 * マニフェストファイルは、sourceNodes の中で公開アクション unstable_createNodeManifest によって追加される
 */
export async function processNodeManifests(): Promise<Map<
  string,
  string
> | null> {
  const verboseLogs =
    process.env.gatsby_log_level === `verbose` ||
    process.env.VERBOSE_NODE_MANIFEST === `true`

  const startTime = Date.now()
  let { nodeManifests } = store.getState()

  const totalManifests = nodeManifests.length

  if (totalManifests === 0) {
    return null
  }

  let totalProcessedManifests = 0
  let totalFailedManifests = 0
  const nodeManifestPagePathMap: Map<string, string> = new Map()
  const listOfUniqueErrorIds: Set<string> = new Set()
  const previouslyWrittenNodeManifests: PreviouslyWrittenNodeManifests =
    new Map()

  async function processNodeManifestTask(
    manifest: INodeManifest,
    cb: fastq.done<any>
  ): Promise<void> {
    const processedManifest = await processNodeManifest(
      manifest,
      listOfUniqueErrorIds,
      nodeManifestPagePathMap,
      verboseLogs,
      previouslyWrittenNodeManifests
    )

    if (processedManifest) {
      totalProcessedManifests++
    } else {
      totalFailedManifests++
    }

    // 下の `setImmediate` は、マニフェストが多いときに起きる
    // スタックオーバーフローへの回避策である
    setImmediate(() => cb(null, true))
    return
  }

  const processNodeManifestQueue = fastq(processNodeManifestTask, 25)

  if (totalManifests > NODE_MANIFEST_FILE_LIMIT) {
    nodeManifests = [...nodeManifests]
    nodeManifests.sort(nodeManifestSortComparerAscendingUpdatedAt)
    nodeManifests = nodeManifests.slice(0, NODE_MANIFEST_FILE_LIMIT)
  }

  for (const manifest of nodeManifests) {
    processNodeManifestQueue.push(manifest, () => {})
  }

  if (!processNodeManifestQueue.idle()) {
    await new Promise(resolve => {
      processNodeManifestQueue.drain = resolve as () => unknown
    })
  }

  const pluralize = (length: number): string =>
    length > 1 || length === 0 ? `s` : ``

  const endTime = Date.now()

  reporter.info(
    `Wrote out ${totalProcessedManifests} node page manifest file${pluralize(
      totalProcessedManifests
    )} in ${endTime - startTime} ms. ${
      totalFailedManifests > 0
        ? `. ${totalFailedManifests} manifest${pluralize(
            totalFailedManifests
          )} couldn't be processed.`
        : ``
    }`
  )

  reporter.info(
    (!verboseLogs && listOfUniqueErrorIds.size > 0
      ? `unstable_createNodeManifest produced warnings [${[
          ...listOfUniqueErrorIds,
        ].join(`, `)}]. `
      : ``) +
      `To see full warning messages set process.env.VERBOSE_NODE_MANIFEST to "true".\nVisit https://gatsby.dev/nodemanifest for more info on Node Manifests.`
  )

  // 保留中のすべてのマニフェストをストアから片付ける
  store.dispatch(internalActions.deleteNodeManifests())
  return nodeManifestPagePathMap
}
