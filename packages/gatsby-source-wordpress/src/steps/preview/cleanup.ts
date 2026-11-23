import { inPreviewMode, PreviewStatusUnion } from "."
import { OnPageCreatedCallback } from "~/models/preview"
import { getStore } from "~/store"
import { NodePluginArgs } from "gatsby"

/**
 * このコールバックは、WP にプレビューの状態を送るために呼び出される。この場合の状態は、
 * プレビュー対象のノードに対応するページが見つからなかった、というものである
 */
const invokeLeftoverPreviewCallback =
  ({
    getNode,
    status,
    context,
    error,
  }: {
    status: PreviewStatusUnion
    context?: string
    error?: Error
    getNode: NodePluginArgs["getNode"]
  }) =>
  async ([nodeId, callback]: [
    string,
    OnPageCreatedCallback,
  ]): Promise<void> => {
    const passedNode = getNode(nodeId)

    await callback({
      passedNode,
      nodeId,
      // このノードのページは作成されていないので、path として null を渡す。
      // 作成されていれば、このコールバックは処理のもっと早い段階で取り除かれている
      pageNode: { path: null },
      status,
      context,
      error,
    })
  }

export const invokeAndCleanupLeftoverPreviewCallbacks = async ({
  status,
  context,
  error,
}: {
  status: PreviewStatusUnion
  context?: string
  error?: Error
}): Promise<void> => {
  const state = getStore().getState()

  const { getNode } = state.gatsbyApi.helpers

  const leftoverCallbacks = state.previewStore.nodePageCreatedCallbacks

  const leftoverCallbacksExist = Object.keys(leftoverCallbacks).length

  if (leftoverCallbacksExist) {
    await Promise.all(
      Object.entries(leftoverCallbacks).map(
        invokeLeftoverPreviewCallback({ getNode, status, context, error })
      )
    )

    // コールバックを処理した後は、将来また呼ばれないよう、すべて取り除く必要がある
    getStore().dispatch.previewStore.clearPreviewCallbacks()
  }
}

/**
 * プレビューのコールバックは通常、Gatsby Preview の onCreatePage の中で呼び出され、
 * 作成されたページのプレビューの状態を WP へ送り返す
 * プレビュー対象のノードのページが作成されなかった場合は、コールバックが
 * 残ったままになり、WP はプレビューの状態を知ることができない
 * そこで、（ページの作成後に実行される）onPreExtractQueries で、まだ呼び出されていない
 * プレビューのコールバックを調べ、"NO_PAGE_CREATED_FOR_PREVIEWED_NODE" の状態で呼び出して、その状態を WP へ送る
 * 残っていたものをすべて呼び出した後は、後でまた呼ばれないようストアから消去する。
 */
export const onPreExtractQueriesInvokeLeftoverPreviewCallbacks =
  async (): Promise<void> => {
    if (!inPreviewMode()) {
      return invokeAndCleanupLeftoverPreviewCallbacks({
        status: `GATSBY_PREVIEW_PROCESS_ERROR`,
        context: `Gatsby is not in Preview mode.`,
      })
    }

    // createPages の中で呼ばれなかった onCreatePageCallbacks があるかを確認する
    // プレビュー用のページが作成されなかったことを WP に伝える必要がある
    return invokeAndCleanupLeftoverPreviewCallbacks({
      status: `NO_PAGE_CREATED_FOR_PREVIEWED_NODE`,
      context: `invokeAndCleanupLeftoverPreviewCallbacks`,
    })
  }
