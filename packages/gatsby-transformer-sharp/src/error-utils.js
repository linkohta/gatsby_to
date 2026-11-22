export const CODES = {
  Generic: `20000`,
  MissingResource: `20001`,
}

export const pluginPrefix = `gatsby-transformer-sharp`

export function prefixId(id) {
  return `${pluginPrefix}_${id}`
}

// TODO: reporter.setErrorMap が確実に使えるようになったら、
// context.sourceMessage だけでなくコンテキストのデータを使うようリファクタリングする
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
