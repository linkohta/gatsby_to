import { Step } from "./../utils/run-steps"
import { getStore } from "~/store"
import { getGatsbyApi } from "~/utils/get-gatsby-api"
import { getPersistentCache } from "~/utils/cache"
import { needToTouchNodes } from "~/utils/gatsby-features"

const persistPreviouslyCachedImages: Step = async (): Promise<void> => {
  const { helpers, pluginOptions } = getGatsbyApi()

  // 既存のメディアアイテムのノードをすべて取得する
  const mediaItemNodes = helpers.getNodesByType(
    `${pluginOptions.schema.typePrefix}MediaItem`
  )

  if (needToTouchNodes) {
    // 必要であれば、ガベージコレクションされないよう touch する。
    // WP から DELETE イベントを受け取ったときに、必要に応じて削除する
    mediaItemNodes.forEach(node => helpers.actions.touchNode(node))
  }

  const imageNodeMetaByUrl = await getPersistentCache({
    key: `image-node-meta-by-url`,
  })

  if (imageNodeMetaByUrl) {
    getStore().dispatch.imageNodes.setState({
      nodeMetaByUrl: imageNodeMetaByUrl,
    })
  }
}

export { persistPreviouslyCachedImages }
