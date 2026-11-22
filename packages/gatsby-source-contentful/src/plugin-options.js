// @ts-check
import chalk from "chalk"
import _ from "lodash"

const DEFAULT_PAGE_LIMIT = 1000

const defaultOptions = {
  host: `cdn.contentful.com`,
  environment: `master`,
  downloadLocal: false,
  localeFilter: () => true,
  contentTypeFilter: () => true,
  pageLimit: DEFAULT_PAGE_LIMIT,
  useNameForId: true,
  enableTags: false,
  typePrefix: `Contentful`,
}

const createPluginConfig = pluginOptions => {
  const conf = { ...defaultOptions, ...pluginOptions }

  return {
    get: key => conf[key],
    getOriginalPluginOptions: () => pluginOptions,
  }
}

const maskedFields = [`accessToken`, `spaceId`]

const formatPluginOptionsForCLI = (pluginOptions, errors = {}) => {
  const optionKeys = new Set(
    Object.keys(pluginOptions)
      .concat(Object.keys(defaultOptions))
      .concat(Object.keys(errors))
  )

  const getDisplayValue = key => {
    const formatValue = value => {
      if (_.isFunction(value)) {
        return `[Function]`
      } else if (maskedFields.includes(key) && typeof value === `string`) {
        return JSON.stringify(maskText(value))
      }
      return JSON.stringify(value)
    }

    if (typeof pluginOptions[key] !== `undefined`) {
      return chalk.green(formatValue(pluginOptions[key]))
    } else if (typeof defaultOptions[key] !== `undefined`) {
      return chalk.dim(formatValue(defaultOptions[key]))
    }

    return chalk.dim(`undefined`)
  }

  const lines = []
  optionKeys.forEach(key => {
    if (key === `plugins`) {
      // gatsby が自動的に追加する plugins フィールドはスキップする
      return
    }

    lines.push(
      `${key}${
        typeof pluginOptions[key] === `undefined` &&
        typeof defaultOptions[key] !== `undefined`
          ? chalk.dim(` (default value)`)
          : ``
      }: ${getDisplayValue(key)}${
        typeof errors[key] !== `undefined` ? ` - ${chalk.red(errors[key])}` : ``
      }`
    )
  })
  return lines.join(`\n`)
}

/**
 * 秘密情報が漏れないよう、入力の大部分をマスクする
 * @param {string} input
 * @returns {string} マスクしたテキスト
 */
const maskText = input => {
  // 文字列の 25% だけを、最大 4 文字まで表示する
  const hiddenCharactersLength =
    input.length - Math.min(4, Math.floor(input.length * 0.25))

  return `${`*`.repeat(hiddenCharactersLength)}${input.substring(
    hiddenCharactersLength
  )}`
}

export {
  defaultOptions,
  formatPluginOptionsForCLI,
  maskText,
  createPluginConfig,
}
