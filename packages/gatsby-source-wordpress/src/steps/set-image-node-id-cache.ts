import { getStore } from "~/store"
import { setPersistentCache } from "~/utils/cache"

// 画像ノードはリゾルバーで作成するので、
// 本番ではビルド後に、開発時は開発サーバーの作成時に、
// 画像ノードの id をキャッシュする
// こうすることで develop と build の両方で画像ノードを touch でき、
// Gatsby にガベージコレクションされない
const setImageNodeIdCache = async (): Promise<void> => {
  const state = getStore().getState()
  const { imageNodes } = state

  if (imageNodes.nodeMetaByUrl) {
    await setPersistentCache({
      key: `image-node-meta-by-url`,
      value: imageNodes.nodeMetaByUrl,
    })
  }
}

export { setImageNodeIdCache }
