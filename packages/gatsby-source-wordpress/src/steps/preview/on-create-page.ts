import { formatLogMessage } from "~/utils/format-log-message"
import { getStore } from "~/store"
import { GatsbyNodeApiHelpers } from "~/utils/gatsby-types"
import { inPreviewMode } from "."

/**
 * onCreatePage では、ページがどのノードに依存しているかを突き止め、
そのページを state に保存する。プレビュー中にページが更新されたとき、
ページの情報を WordPress へ返せるようにするためである。
そのために、pageContext.id からノード id を見つけている
理想的には、pageContext.id に頼らずに検出できるとよい。
store.componentDataDependencies を使う方法も試したが、実装に不具合があり
信頼できなかった。@todo 将来、pageContext.id を不要にすることを
もう一度試す価値がある。
 */
export const onCreatepageSavePreviewNodeIdToPageDependency = (
  helpers: GatsbyNodeApiHelpers
): void => {
  // プレビューモードでなければ、これを追跡する必要はない
  if (!inPreviewMode()) {
    return
  }

  const { page, getNode } = helpers

  const nodeThatCreatedThisPage =
    page.context && page.context.id && getNode(page.context.id)

  if (nodeThatCreatedThisPage) {
    getStore().dispatch.previewStore.saveNodePageState({
      nodeId: nodeThatCreatedThisPage.id,
      page: {
        path: page.path,
        updatedAt: page.updatedAt,
      },
    })
  }
}

/**
 * onCreatePage では、このページの元になったノードが更新されたか、
 * またそれを待っているコールバックがあるかを確認する
 * 両方が当てはまる場合は、コールバックを呼び出して
 * WP のインスタンスのプレビュークライアントへ応答する
 */
export const onCreatePageRespondToPreviewStatusQuery = async (
  helpers: GatsbyNodeApiHelpers
): Promise<void> => {
  // プレビューモードでなければ、これを設定する必要はない
  if (!inPreviewMode()) {
    return
  }

  const { nodePageCreatedCallbacks, pagePathToNodeDependencyId } =
    getStore().getState().previewStore

  const { page, getNode } = helpers

  if (
    !nodePageCreatedCallbacks ||
    !Object.keys(nodePageCreatedCallbacks).length
  ) {
    return
  }

  const nodeIdThatCreatedThisPage =
    pagePathToNodeDependencyId?.[page.path]?.nodeId

  if (!nodeIdThatCreatedThisPage) {
    return
  }

  const nodePageCreatedCallback =
    nodeIdThatCreatedThisPage &&
    nodePageCreatedCallbacks[nodeIdThatCreatedThisPage]

  if (
    !nodeIdThatCreatedThisPage ||
    typeof nodePageCreatedCallback !== `function`
  ) {
    return
  }

  getStore().dispatch.previewStore.unSubscribeToPagesCreatedFromNodeById({
    nodeId: nodeIdThatCreatedThisPage,
  })

  const nodeThatCreatedThisPage = getNode(nodeIdThatCreatedThisPage)

  if (!nodeThatCreatedThisPage) {
    helpers.reporter.warn(
      formatLogMessage(
        `There was an attempt to call a Preview onPageCreated callback for node ${nodeIdThatCreatedThisPage}, but no node was found.`
      )
    )
    return
  }

  // WP 側で読めるよう、更新時刻を pageContext に追加する必要がある
  // これにより、更新されたページがデプロイされたことを判別できる
  if (!page.context.__wpGatsbyNodeModified) {
    const pageCopy = { ...page }
    pageCopy.context.__wpGatsbyNodeModified = nodeThatCreatedThisPage.modified

    const { deletePage, createPage } = helpers.actions

    deletePage(page)
    createPage(pageCopy)
  }

  await nodePageCreatedCallback({
    passedNode: nodeThatCreatedThisPage,
    pageNode: page,
    context: `onCreatePage Preview callback invocation`,
    status: `PREVIEW_SUCCESS`,
  })
}
