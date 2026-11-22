import { GatsbyNodeApiHelpers } from "~/utils/gatsby-types"
import merge from "lodash/merge"
import { createLocalFileNode } from "~/steps/source-nodes/create-nodes/create-local-file-node"
import { menuBeforeChangeNode } from "~/steps/source-nodes/before-change-node/menu"
import { cloneDeep } from "lodash"
import { inPreviewMode } from "~/steps/preview"
import { usingGatsbyV4OrGreater } from "~/utils/gatsby-version"
import { createModel } from "@rematch/core"
import { IRootModel } from "."

export interface IPluginOptionsPreset {
  presetName: string
  useIf: (
    helpers: GatsbyNodeApiHelpers,
    pluginOptions: IPluginOptions
  ) => boolean
  options: IPluginOptions
}

export const previewOptimizationPreset: IPluginOptionsPreset = {
  presetName: `PREVIEW_OPTIMIZATION`,
  useIf: inPreviewMode,
  options: {
    html: {
      useGatsbyImage: false,
      createStaticFiles: false,
    },

    type:
      // Gatsby v4 以降では、リゾルバーの中でノードを取得できない。
      // つまり、v4 以降で次の設定を適用すると、limit オプションのために
      // 取得されなかったノードをコネクションフィールドが参照している場合に、
      // サイトのデータが大量に欠けることになる。
      // そのため、次の設定は Gatsby v4 より前でだけ適用する
      !usingGatsbyV4OrGreater
        ? {
            __all: {
              limit: 50,
            },
            Comment: {
              limit: 0,
            },
            Menu: {
              limit: null,
            },
            MenuItem: {
              limit: null,
            },
            User: {
              limit: null,
            },
          }
        : {},
  },
}
export interface IPluginOptions {
  url?: string
  verbose?: boolean
  debug?: {
    throwRefetchErrors?: boolean
    graphql?: {
      showQueryOnError?: boolean
      showQueryVarsOnError?: boolean
      copyQueryOnError?: boolean
      panicOnError?: boolean
      onlyReportCriticalErrors?: boolean
      copyNodeSourcingQueryAndExit?: boolean
      writeQueriesToDisk?: boolean
      copyHtmlResponseOnError?: boolean
      printIntrospectionDiff?: boolean
    }
    timeBuildSteps?: Array<string> | boolean
    disableCompatibilityCheck?: boolean
    preview?: boolean
  }
  develop?: {
    nodeUpdateInterval?: number
    hardCacheMediaFiles?: boolean
    hardCacheData?: boolean
  }
  production?: {
    hardCacheMediaFiles?: boolean
    allow404Images?: boolean
    allow401Images?: boolean
  }
  auth?: {
    htaccess: {
      username: string | null
      password: string | null
    }
  }
  schema?: {
    queryDepth: number
    circularQueryLimit: number
    typePrefix: string
    timeout: number // 30 秒
    perPage: number
    requestConcurrency?: number
    previewRequestConcurrency?: number
  }
  excludeFieldNames?: []
  html?: {
    useGatsbyImage?: boolean
    gatsbyImageOptions?: Record<string, unknown>
    imageMaxWidth?: number
    fallbackImageMaxWidth?: number
    imageQuality?: number
    createStaticFiles?: boolean
    placeholderType?: `blurred` | `dominantColor`
  }
  presets?: Array<IPluginOptionsPreset>
  type?: {
    [typename: string]: {
      limit?: number
      excludeFieldNames?: Array<string>

      exclude?: boolean
      // @todo これに型を付ける
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      beforeChangeNode?: (any) => Promise<any>
      nodeInterface?: boolean
      lazyNodes?: boolean
      createFileNodes?: boolean
      localFile?: {
        excludeByMimeTypes?: Array<string>
        maxFileSizeBytes?: number
        requestConcurrency?: number
      }

      placeholderSizeName?: string
    }
  }
}

const defaultPluginOptions: IPluginOptions = {
  url: null,
  verbose: true,
  debug: {
    throwRefetchErrors: false,
    graphql: {
      showQueryOnError: false,
      showQueryVarsOnError: false,
      copyQueryOnError: false,
      panicOnError: false,
      onlyReportCriticalErrors: true,
      copyNodeSourcingQueryAndExit: false,
      writeQueriesToDisk: false,
      copyHtmlResponseOnError: false,
      printIntrospectionDiff: false,
    },
    timeBuildSteps: false,
    disableCompatibilityCheck: false,
    preview: false,
  },
  develop: {
    nodeUpdateInterval: 5000,
    hardCacheMediaFiles: false,
    hardCacheData: false,
  },
  production: {
    hardCacheMediaFiles: false,
    allow404Images: false,
    allow401Images: false,
  },
  auth: {
    htaccess: {
      username: null,
      password: null,
    },
  },
  schema: {
    queryDepth: 15,
    circularQueryLimit: 5,
    typePrefix: `Wp`,
    timeout: 30 * 1000, // 30 秒
    perPage: 100,
    requestConcurrency: 15,
    previewRequestConcurrency: 5,
  },
  excludeFieldNames: [],
  html: {
    // これを指定すると、ソースプラグインが html 内の画像を検索して置き換える
    useGatsbyImage: true,
    // 画像の最大幅に上限を設ける
    // WP で選択された画像がこれより小さい場合や、画像自体がこれより小さい場合は、
    // 代わりにそれらの値が使われる。
    imageMaxWidth: null,
    // html から最大幅を推定できない場合は、この値が Sharp に渡される
    // 画像がこれより小さい場合は、代わりに画像の幅が使われる
    fallbackImageMaxWidth: 1024,
    imageQuality: 90,
    //
    // （wp-content のファイルを指す）アンカーリンク、video の src、audio の src を、ローカルの静的ファイルへのリンクに変換する
    // ファイルがまだ存在しなければ取得も行う
    createStaticFiles: true,
    //
    // html.useGatsbyImage も設定されている場合に、HTML フィールド内の画像に画像オプションを追加する
    gatsbyImageOptions: {},

    placeholderType: `blurred`,
  },
  presets: [previewOptimizationPreset],
  type: {
    __all: {
      // @todo dateFields をプラグインオプションにするか検討する。現在はなっていない
      // WPGraphQL に近く Date 型が追加されるので、不要かもしれない
      // dateFields: [`date`],
    },
    RootQuery: {
      excludeFieldNames: [`viewer`, `node`, `schemaMd5`],
    },
    UserToMediaItemConnection: {
      // この型を除外しないと、ノードのソーシング中にユーザーごとに最大 100 件の
      // メディアアイテムを余分に取得する可能性がある
      exclude: true,
    },
    WpContentNodeToEditLockConnectionEdge: {
      exclude: true,
    },
    WPPageInfo: {
      exclude: true,
    },
    ActionMonitorAction: {
      exclude: true,
    },
    UserToActionMonitorActionConnection: {
      exclude: true,
    },
    Plugin: {
      exclude: true,
    },
    Theme: {
      exclude: true,
    },
    MediaItem: {
      exclude: false,
      placeholderSizeName: `gatsby-image-placeholder`,
      lazyNodes: false,
      createFileNodes: true,
      localFile: {
        excludeByMimeTypes: [],
        maxFileSizeBytes: 15728640, // 15Mb
        requestConcurrency: 100,
      },
      beforeChangeNode: async ({
        remoteNode,
        actionType,
        typeSettings,
        // @todo これに型を付ける
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }): Promise<any> => {
        if (
          // 遅延ノードのファイルはリゾルバーで取得するので、ここで取得する必要はない。
          typeSettings.lazyNodes ||
          // または、ユーザーがファイルノードの作成を望んでいない場合は、何もしない。
          !typeSettings.createFileNodes
        ) {
          return {
            remoteNode,
          }
        }

        if (
          actionType === `CREATE_ALL` ||
          actionType === `CREATE` ||
          actionType === `UPDATE`
        ) {
          const createdMediaItem = await createLocalFileNode({
            mediaItemNode: remoteNode,
            parentName: `Node action ${actionType}`,
          })

          if (createdMediaItem) {
            remoteNode.localFile = {
              id: createdMediaItem.id,
            }

            return {
              remoteNode,
            }
          }
        }

        return {
          remoteNode,
        }
      },
    },
    ContentNode: {
      nodeInterface: true,
    },
    TermNode: {
      nodeInterface: true,
    },
    Menu: {
      /**
       * これは、Menu の子メニュー項目を取得するために使う
       * 現在の WPGQL では、ほかの方法で取得するのが
       * 難しいためである
       *
       * Menu ノードを取得して処理した後に、この関数が実行される
       * 子メニュー項目を順に処理し、それらのクエリを生成して
       * 取得し、ノードを作成する。
       *
       * これは、最初にすべてのノードを取得するときと、差分取得の後に
       * 実行される
       *
       * WPGQL で、場所に関係なくすべてのメニュー項目の一覧を取得できるようになれば、これは削除できる。
       */
      beforeChangeNode: menuBeforeChangeNode,
    },
  },
}

export interface IGatsbyApiState {
  helpers: GatsbyNodeApiHelpers
  pluginOptions: IPluginOptions
  activePluginOptionsPresets?: Array<IPluginOptionsPreset>
}

const gatsbyApi = createModel<IRootModel>()({
  state: {
    helpers: {},
    pluginOptions: defaultPluginOptions,
  } as IGatsbyApiState,

  reducers: {
    setState(
      state: IGatsbyApiState,
      payload: IGatsbyApiState
    ): IGatsbyApiState {
      const stateCopy = cloneDeep(state)

      const defaultPresets = stateCopy.pluginOptions?.presets || []
      const userPresets = payload.pluginOptions?.presets || []

      /**
       * プリセットは、`useIf` 関数（boolean を返す）に基づいて条件付きで
       * 適用される、プラグインオプションの設定である
       * この関数が true を返すと、そのプリセットが使われる。
       */
      const optionsPresets = [...defaultPresets, ...userPresets]?.filter(
        preset => preset.useIf(payload.helpers, payload.pluginOptions)
      )

      if (optionsPresets?.length) {
        state.activePluginOptionsPresets = optionsPresets

        let presetModifiedOptions = state.pluginOptions

        for (const preset of optionsPresets) {
          presetModifiedOptions = merge(presetModifiedOptions, preset.options)
        }

        state.pluginOptions = presetModifiedOptions
      }

      // どのプリセットよりも優先されるよう、ユーザーが定義したプラグインオプションを最後に追加する
      state = merge(state, payload)

      return state
    },
  },
  effects: () => {
    return {}
  },
})

export default gatsbyApi
