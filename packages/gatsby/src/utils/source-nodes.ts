import report from "gatsby-cli/lib/reporter"
import { Span } from "opentracing"
import { sourceNodesApiRunner } from "./source-nodes-api-runner"
import { store } from "../redux"
import { getDataStore, getNode } from "../datastore"
import { actions } from "../redux/actions"
import { IGatsbyState, IGatsbyNode } from "../redux/types"
import type { GatsbyIterable } from "../datastore/common/iterable"

const { deleteNode } = actions

/**
 * ノードを作成する可能性のある Gatsby の API を実装しているが、
 * 実際にはノードを 1 つも作成していないプラグインの名前をすべて探す。
 */
function discoverPluginNamesWithoutNodes(): Array<string> {
  const { typeOwners, flattenedPlugins } = store.getState()

  // 作成済みのノードをどのプラグインが所有しているかを調べる
  const pluginNamesThatCreatedNodes = new Set([
    `default-site-plugin`,
    // ノードの型を所有しているプラグインは、どこかの時点でノードを作成している
    ...Array.from(typeOwners.pluginsToTypes.keys()),
  ])

  return flattenedPlugins
    .filter(
      plugin =>
        // 「ノードを生成できる」
        plugin.nodeAPIs.includes(`sourceNodes`) &&
        // 「ノードを生成していない」
        !pluginNamesThatCreatedNodes.has(plugin.name)
    )
    .map(plugin => plugin.name)
}

/**
 * ノードを作成するはずなのに作成しなかったプラグインについて警告する。
 */
function warnForPluginsWithoutNodes(): void {
  const pluginNamesWithNoNodes = discoverPluginNamesWithoutNodes()

  pluginNamesWithNoNodes.map(name =>
    report.warn(
      `The ${name} plugin has generated no Gatsby nodes. Do you need it? This could also suggest the plugin is misconfigured.`
    )
  )
}

/**
 * ルートノードがタッチされていないノードの集合を返す
 */
function getStaleNodes(
  state: IGatsbyState,
  nodes: GatsbyIterable<IGatsbyNode>
): GatsbyIterable<IGatsbyNode> {
  return nodes.filter(node => {
    let rootNode = node
    let next: IGatsbyNode | undefined = undefined

    let whileCount = 0
    do {
      next = rootNode.parent ? getNode(rootNode.parent) : undefined
      if (next) {
        rootNode = next
      }
    } while (next && ++whileCount < 101)

    if (whileCount > 100) {
      console.log(
        `It looks like you have a node that's set its parent as itself`,
        rootNode
      )
    }

    if (state.statefulSourcePlugins.has(rootNode.internal.owner)) {
      return false
    }

    return !state.nodesTouched.has(rootNode.id)
  })
}

/**
 * 古いノードをすべて探して削除する。ただし、古いノードのガベージコレクションの対象から外されたノードの型は除く。
 */
async function deleteStaleNodes(
  previouslyExistingNodeTypeNames: Array<string>
): Promise<void> {
  const state = store.getState()

  let deleteCount = 0

  const cleanupStaleNodesActivity =
    report.createProgress(`Clean up stale nodes`)

  cleanupStaleNodesActivity.start()

  const { typeOwners, statefulSourcePlugins } = state

  for (const typeName of previouslyExistingNodeTypeNames) {
    const pluginName = typeOwners.typesToPlugins.get(typeName)

    // 所有者がステートフルなソースプラグインであると宣言している場合は、この型を確認する必要はない
    if (pluginName && statefulSourcePlugins.has(pluginName)) {
      continue
    }

    report.verbose(`Checking for stale ${typeName} nodes`)

    const nodes = getDataStore().iterateNodesByType(typeName)
    const staleNodes = getStaleNodes(state, nodes)

    for (const node of staleNodes) {
      store.dispatch(deleteNode(node))
      cleanupStaleNodesActivity.tick()

      if (++deleteCount % 5000) {
        // イベントループをブロックしない
        await new Promise(res => {
          setImmediate(() => {
            res(null)
          })
        })
      }
    }
  }

  cleanupStaleNodesActivity.end()
}

// モジュールの内部状態をリセットできるように、ユニットテストのためだけに export している
export const is = {
  initialSourceNodesOfCurrentNodeProcess: true,
}

let sourcingCount = 0
export default async ({
  webhookBody,
  pluginName,
  parentSpan,
  deferNodeMutation = false,
}: {
  webhookBody: unknown
  pluginName?: string
  parentSpan?: Span
  deferNodeMutation?: boolean
}): Promise<void> => {
  const traceId = is.initialSourceNodesOfCurrentNodeProcess
    ? `initial-sourceNodes`
    : `sourceNodes #${sourcingCount}`

  // これはビルドをまたいでキャッシュに永続化されるので、以前に作成された型の、プラグイン名ごとの最新の一覧を常に持っている
  const { typeOwners } = store.getState()

  const previouslyExistingNodeTypeNames: Array<string> = Array.from(
    typeOwners.typesToPlugins.keys() || []
  )

  await sourceNodesApiRunner({
    traceId,
    deferNodeMutation,
    parentSpan,
    webhookBody,
    pluginName,
  })

  await getDataStore().ready()

  // ノードのないプラグインについての警告と、古いノードの削除は、現在のプロセスで最初の sourceNodes の呼び出しのときにだけ行う。
  if (is.initialSourceNodesOfCurrentNodeProcess) {
    is.initialSourceNodesOfCurrentNodeProcess = false

    warnForPluginsWithoutNodes()

    if (
      // これがまったく最初の取得であり、今回の sourceNodes の実行より前に型が 1 つも存在しなかった場合は、古いノードを確認する必要はない。作成されたばかりなので、古いはずがないためである。古いノードを確認するのは、以前に一度も存在しなかったノードの型だけにする。
      previouslyExistingNodeTypeNames.length > 0
    ) {
      await deleteStaleNodes(previouslyExistingNodeTypeNames)
    }
  }

  store.dispatch(actions.apiFinished({ apiName: `sourceNodes` }))

  sourcingCount += 1
}
