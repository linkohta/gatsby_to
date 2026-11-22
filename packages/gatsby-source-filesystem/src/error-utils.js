export const CODES = {
  Generic: `10000`,
  MissingResource: `10001`,
}

export const pluginPrefix = `gatsby-source-filesystem`

export function prefixId(id) {
  return `${pluginPrefix}_${id}`
}

// TODO: reporter.setErrorMap が確実に使えるようになったら、context.sourceMessage だけでなく
// コンテキストのデータを使うようにリファクタリングする
export const ERROR_MAP = {
  [CODES.Generic]: {
    text: context => context.sourceMessage,
    level: `ERROR`,
    type: `PLUGIN`,
  },
  [CODES.MissingResource]: {
    text: context => context.sourceMessage,
    level: `ERROR`,
    type: `PLUGIN`,
    category: `USER`,
  },
}
