import { GatsbyHelpers } from "~/utils/gatsby-types"
import manager from "cache-manager"
import fs from "fs-extra"
import fsStore from "cache-manager-fs-hash"
import path from "path"

import { getStore, withPluginKey } from "~/store"
import { getGatsbyApi } from "~/utils/get-gatsby-api"

import fetchGraphql from "~/utils/fetch-graphql"

import {
  getTypeSettingsByType,
  buildTypeName,
} from "~/steps/create-schema-customization/helpers"

import { createMediaItemNode } from "~/steps/source-nodes/fetch-nodes/fetch-referenced-media-items"
import type { Node } from "gatsby"

const MAX_CACHE_SIZE = 250
const TTL = Number.MAX_SAFE_INTEGER
const cacheDir = `.wordpress-cache/caches`

type Store = manager.StoreConfig[`store`]

interface ICacheOptions {
  name?: string
  store?: Store
}
export default class Cache {
  private store: Store
  private name: string
  private cacheDirectory: string
  private cache: manager.MultiCache
  constructor({ name = `db`, store = fsStore }: ICacheOptions = {}) {
    this.name = name
    this.store = store
    this.cacheDirectory = cacheDir
  }

  get cacheBase(): string {
    return path.join(process.cwd(), this.cacheDirectory)
  }

  get directory(): string {
    return `${this.cacheBase}/${this.name}`
  }

  init(): Cache {
    fs.ensureDirSync(this.directory)

    const configs: Array<manager.StoreConfig> = [
      {
        store: `memory`,
        max: MAX_CACHE_SIZE,
        ttl: TTL,
      },
      {
        store: this.store,
        ttl: TTL,
        options: {
          path: this.directory,
          ttl: TTL,
        },
      },
    ]

    const caches = configs.map(cache => manager.caching(cache))

    this.cache = manager.multiCaching(caches)

    return this
  }

  get(key: string): Promise<unknown> {
    return new Promise(resolve => {
      if (!this.cache) {
        throw new Error(
          `Cache wasn't initialised yet, please run the init method first`
        )
      }
      this.cache.get(key, (err, res) => {
        resolve(err ? undefined : res)
      })
    })
  }

  set(key: string, value: unknown, args = { ttl: TTL }): Promise<unknown> {
    return new Promise(resolve => {
      if (!this.cache) {
        throw new Error(
          `Cache wasn't initialised yet, please run the init method first`
        )
      }
      this.cache.set(key, value, args, err => {
        resolve(err ? undefined : value)
      })
    })
  }
}

const caches = new Map()

export const getCacheInstance = (name: string): Cache => {
  let cache = caches.get(name)
  if (!cache) {
    cache = new Cache({ name }).init()
    caches.set(name, cache)
  }
  return cache
}

export const shouldHardCacheData = (): boolean => {
  const isDevelop = process.env.NODE_ENV === `development`

  if (!isDevelop) {
    return false
  }

  const {
    pluginOptions: {
      develop: { hardCacheData },
    },
  } = getStore().getState().gatsbyApi

  return hardCacheData
}

export const setHardCachedData = async ({
  key,
  value,
}: {
  key: string
  value: unknown
}): Promise<unknown> => {
  if (!shouldHardCacheData()) {
    return
  }

  const hardCache = getCacheInstance(withPluginKey(`wordpress-data`))

  await hardCache.set(key, value)
}

export const getHardCachedData = async <T = Node>({
  key,
}: {
  key: string
}): Promise<T> => {
  if (!shouldHardCacheData()) {
    return null
  }

  const hardCache = getCacheInstance(withPluginKey(`wordpress-data`))

  const data = await hardCache.get(key)

  return data as T
}

export const getHardCachedNodes = async (): Promise<null | Array<Node>> => {
  const allWpNodes = await getHardCachedData<Array<Node>>({ key: `allWpNodes` })

  const shouldUseHardDataCache = allWpNodes?.length

  if (shouldUseHardDataCache) {
    return allWpNodes
  }

  return null
}

const staticFileCacheDirectory = `${process.cwd()}/.wordpress-cache/caches/public/static`
const staticFileDirectory = `${process.cwd()}/public/static`

export const restoreStaticDirectory = async (): Promise<void> => {
  await fs.copy(staticFileCacheDirectory, staticFileDirectory)
}

const copyStaticDirectory = async (): Promise<void> => {
  await fs.copy(staticFileDirectory, staticFileCacheDirectory)
}

export const setHardCachedNodes = async ({
  helpers,
}: {
  helpers: GatsbyHelpers
}): Promise<void> => {
  if (!shouldHardCacheData()) {
    return
  }

  const allNodes = await helpers.getNodes()

  const allWpNodes = allNodes.filter(
    (node: Node) => node.internal.owner === `gatsby-source-wordpress`
  )

  await setHardCachedData({
    key: `allWpNodes`,
    value: allWpNodes,
  })

  // データをハードキャッシュしている場合、
  // インライン HTML の画像のパスは、処理済みでハードキャッシュされた
  // ノードに焼き込まれている。
  // そのため、static ディレクトリをコピーする必要がある
  await copyStaticDirectory()
}

export const clearHardCache = async (): Promise<void> => {
  const directory = new Cache().cacheBase

  // 以前ここで使っていた rimraf のコールバックと同じく、削除に失敗しても処理を続ける
  await fs.remove(directory).catch(() => {})
}

export const clearHardCachedNodes = async (): Promise<void> => {
  const hardCachedNodes = !!(await getHardCachedNodes())

  if (hardCachedNodes) {
    await setHardCachedData({
      key: `allWpNodes`,
      value: null,
    })
  }
}

// 永続キャッシュ
export const setPersistentCache = async ({
  key,
  value,
}: {
  key: string
  value: unknown
}): Promise<void> => {
  const { helpers } = getGatsbyApi()

  await Promise.all([
    // Gatsby のキャッシュに設定する
    helpers.cache.set(withPluginKey(key), value),
    // ハードキャッシュにも設定する
    setHardCachedData({ key, value }),
  ])
}

export const getPersistentCache = async ({
  key,
}: {
  key: string
}): Promise<unknown> => {
  const { helpers } = getGatsbyApi()

  const cachedData = await helpers.cache.get(withPluginKey(key))

  if (cachedData) {
    return cachedData
  }

  const hardCachedData = await getHardCachedData({ key })

  return hardCachedData
}

export const restoreHardCachedNodes = async ({
  hardCachedNodes,
}: {
  hardCachedNodes: Array<Node>
}): Promise<Array<string>> => {
  const loggerTypeCounts = {}

  const { helpers, pluginOptions } = getGatsbyApi()
  const { reporter } = helpers

  // ノードを復元する
  await Promise.all(
    hardCachedNodes.map(async node => {
      if (!loggerTypeCounts[node.internal.type]) {
        loggerTypeCounts[node.internal.type] = 0
      }

      loggerTypeCounts[node.internal.type] += 1

      // メディアアイテムは特別な方法で作成される
      if (node.internal.type.endsWith(`MediaItem`)) {
        delete node.internal

        const { createContentDigest, actions } = helpers

        return createMediaItemNode({
          node,
          helpers,
          createContentDigest,
          actions,
          parentName: `Hard cache restoration`,
          // referencedMediaItemNodeIds,
          // allMediaItemNodes = [],
        })
      }

      node.internal = {
        contentDigest: node.internal.contentDigest,
        type: node.internal.type,
      } as Node[`internal`]

      const typeSettingsCache = {}

      const typeSettings =
        // TODO: wordpress 用にノードの型を拡張する？
        typeSettingsCache[node.type as string] ??
        getTypeSettingsByType({
          name: node.type,
        })

      let remoteNode = node

      if (
        typeSettings.beforeChangeNode &&
        typeof typeSettings.beforeChangeNode === `function`
      ) {
        const {
          // additionalNodeIds: receivedAdditionalNodeIds,
          remoteNode: receivedRemoteNode,
          // cancelUpdate: receivedCancelUpdate,
        } =
          (await typeSettings.beforeChangeNode({
            actionType: `CREATE_ALL`,
            remoteNode,
            actions: helpers.actions,
            helpers,
            fetchGraphql,
            typeSettings,
            buildTypeName,
            type: node.type,
            wpStore: getStore(),
          })) || {}

        if (receivedRemoteNode) {
          remoteNode = receivedRemoteNode
        }
      }

      // 各ノードを復元する
      // TODO: gatsby の型を更新する
      await helpers.actions.createNode(remoteNode)

      return null
    })
  )

  Object.entries(loggerTypeCounts).forEach(([typeName, count]) => {
    getStore().dispatch.logger.createActivityTimer({
      typeName,
      pluginOptions,
      reporter,
    })

    getStore().dispatch.logger.incrementActivityTimer({
      typeName,
      by: count,
      action: `restored`,
    })

    getStore().dispatch.logger.stopActivityTimer({
      typeName,
      action: `restored`,
    })
  })

  // static ディレクトリを復元する
  await restoreStaticDirectory()

  // 1 つ上の階層でキャッシュする createdNodeIds の id 配列を組み立てる
  const createdNodeIds = hardCachedNodes.map(node => node.id)

  return createdNodeIds
}
