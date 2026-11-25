const { defaultHandlers } = require(`mdast-util-to-hast`)

module.exports = handler

function handler(state, node) {
  const result = defaultHandlers.code(state, node)

  if (node.meta && result.children[0]) {
    result.children[0].properties.dataMeta = node.meta
  }

  return result
}
