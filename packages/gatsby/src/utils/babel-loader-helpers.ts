import path from "path"
import _ from "lodash"
import Babel, {
  ConfigItem,
  PluginItem,
  CreateConfigItemOptions,
} from "@babel/core"

import { IBabelStage } from "../redux/types"
import { Stage } from "../commands/types"

interface ILoadCachedConfigReturnType {
  stages: {
    test: IBabelStage
  }
}

const loadCachedConfig = (): ILoadCachedConfigReturnType => {
  let pluginBabelConfig = {
    stages: {
      test: { plugins: [], presets: [] },
    },
  }
  if (process.env.NODE_ENV !== `test`) {
    pluginBabelConfig = require(
      path.join(process.cwd(), `./.cache/babelState.json`)
    )
  }
  return pluginBabelConfig
}

export const getCustomOptions = (stage: Stage): IBabelStage["options"] => {
  const pluginBabelConfig = loadCachedConfig()
  return pluginBabelConfig.stages[stage].options
}

/**
 * https://babeljs.io/docs/en/babel-core#createconfigitem
 * あるプラグインについてこの関数が複数回呼ばれると、
 * Babel はそのプラグインの関数自体を複数回呼ぶ。
 * 注入するプラグインとプリセットがはっきり決まっている場合は、
 * 設定アイテムをあらかじめ作成しておくことを推奨する。
 */
const configItemsMemoCache = new Map()

export interface ICustomOptions extends Record<string, unknown> {
  stage: Stage
  resourceQuery: string
}

export const prepareOptions = (
  babel: typeof Babel,
  customOptions: ICustomOptions,
  resolve: RequireResolve = require.resolve
): Array<Array<PluginItem>> => {
  const {
    stage,
    reactRuntime,
    reactImportSource,
    isPageTemplate,
    resourceQuery,
  } = customOptions

  const configItemsMemoCacheKey = `${stage}-${isPageTemplate}-${resourceQuery}`

  if (configItemsMemoCache.has(configItemsMemoCacheKey)) {
    return configItemsMemoCache.get(configItemsMemoCacheKey)
  }

  const pluginBabelConfig = loadCachedConfig()

  // 必須のプラグインとプリセット
  const requiredPlugins = [
    babel.createConfigItem(
      [
        resolve(`babel-plugin-remove-graphql-queries`),
        // packages/babel-plugin-remove-graphql-queries/src/index.ts が staticQueryDir のデフォルト値を設定している
        // 両者は同じ値でなければならない
        { stage, staticQueryDir: `page-data/sq/d` },
      ],
      {
        type: `plugin`,
      }
    ),
  ]

  if ((stage === `develop` || stage === `build-javascript`) && isPageTemplate) {
    const apis = [`getServerData`, `config`]

    if (
      resourceQuery.includes(`?export=default`) ||
      resourceQuery.includes(`&export=default`)
    ) {
      apis.push(`Head`)
    }

    if (
      resourceQuery.includes(`?export=head`) ||
      resourceQuery.includes(`&export=head`)
    ) {
      apis.push(`default`)
    }

    requiredPlugins.push(
      babel.createConfigItem(
        [
          resolve(`./babel/babel-plugin-remove-api`),
          {
            apis,
          },
        ],
        {
          type: `plugin`,
        }
      )
    )
  }

  if (
    stage === `develop` ||
    stage === `build-html` ||
    stage === `develop-html`
  ) {
    requiredPlugins.push(
      babel.createConfigItem(
        [resolve(`./babel/babel-plugin-add-slice-placeholder-location`)],
        {
          type: `plugin`,
        }
      )
    )
  }

  const requiredPresets: Array<PluginItem> = []

  if (stage === `develop`) {
    requiredPlugins.push(
      babel.createConfigItem([resolve(`react-refresh/babel`)], {
        type: `plugin`,
      })
    )
  }

  // フォールバックのプリセット
  const fallbackPresets: Array<ConfigItem> = []

  fallbackPresets.push(
    babel.createConfigItem(
      [
        resolve(`babel-preset-gatsby`),
        {
          stage,
          reactRuntime,
          reactImportSource,
        },
      ],
      {
        type: `preset`,
      }
    )
  )

  // babel の状態を順に見て、そこからプリセットとプラグインの設定アイテムを作成する。
  const reduxPlugins: Array<PluginItem> = []
  const reduxPresets: Array<PluginItem> = []

  if (stage) {
    pluginBabelConfig.stages[stage].plugins.forEach(plugin => {
      reduxPlugins.push(
        babel.createConfigItem([resolve(plugin.name), plugin.options], {
          dirname: plugin.name,
          type: `plugin`,
        })
      )
    })
    pluginBabelConfig.stages[stage].presets.forEach(preset => {
      reduxPresets.push(
        babel.createConfigItem([resolve(preset.name), preset.options], {
          dirname: preset.name,
          type: `preset`,
        })
      )
    })
  }

  const toReturn = [
    reduxPresets,
    reduxPlugins,
    requiredPresets,
    requiredPlugins,
    fallbackPresets,
  ]

  configItemsMemoCache.set(configItemsMemoCacheKey, toReturn)

  return toReturn
}

export const addRequiredPresetOptions = (
  babel: typeof Babel,
  presets: Array<ConfigItem>,
  options: { stage?: Stage } = {},
  resolve: RequireResolve = require.resolve
): Array<PluginItem> => {
  // `stage` オプションは常に babel-preset-gatsby に渡す
  //  （独自の babelrc で定義されている場合でも）
  const gatsbyPresetResolved = resolve(`babel-preset-gatsby`)
  const index = presets.findIndex(
    p => p.file!.resolved === gatsbyPresetResolved
  )

  if (index !== -1) {
    presets[index] = babel.createConfigItem(
      [
        gatsbyPresetResolved,
        { ...presets[index].options, stage: options.stage },
      ],
      { type: `preset` }
    )
  }
  return presets
}

export const mergeConfigItemOptions = ({
  items,
  itemToMerge,
  type,
  babel,
}: {
  items: Array<ConfigItem>
  itemToMerge: ConfigItem
  type: CreateConfigItemOptions["type"]
  babel: typeof Babel
}): Array<ConfigItem> => {
  const index = _.findIndex(
    items,
    i => i.file?.resolved === itemToMerge.file?.resolved
  )

  // これが存在する場合はオプションをマージし、そうでなければ配列に追加する
  if (index !== -1) {
    items[index] = babel.createConfigItem(
      [
        itemToMerge.file?.resolved,
        _.merge({}, items[index].options, itemToMerge.options),
      ],
      {
        type,
      }
    )
  } else {
    items.push(itemToMerge)
  }

  return items
}
