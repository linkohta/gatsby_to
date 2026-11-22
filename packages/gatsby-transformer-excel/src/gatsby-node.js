const XLSX = require(`xlsx`)
const _ = require(`lodash`)

const extensions = [
  `xls`,
  `xlsx`,
  `xlsm`,
  `xlsb`,
  `xml`,
  `xlw`,
  `xlc`,
  `csv`,
  `txt`,
  `dif`,
  `sylk`,
  `slk`,
  `prn`,
  `ods`,
  `fods`,
  `uos`,
  `dbf`,
  `wks`,
  `123`,
  `wq1`,
  `qpw`,
  `htm`,
  `html`,
  `numbers`,
]

function shouldOnCreateNode({ node }) {
  return extensions.includes((node.extension || ``).toLowerCase())
}

async function onCreateNode(
  { node, actions, loadNodeContent, createNodeId, createContentDigest },
  options = {}
) {
  const { createNode, createParentChildLink } = actions

  // sheet_to_json 関数に渡す「すべての」オプションを受け付ける
  const xlsxOptions = options
  // raw がまだ定義されていなければ、レガシーな `rawOutput` を正しい `raw` 属性の別名として扱う
  if (!_.has(xlsxOptions, `raw`) && _.has(xlsxOptions, `rawOutput`)) {
    xlsxOptions.raw = xlsxOptions.rawOutput
  }
  if (!_.has(xlsxOptions, `defval`) && _.has(xlsxOptions, `defaultValue`)) {
    xlsxOptions.defval = xlsxOptions.defaultValue
  }
  delete xlsxOptions.rawOutput
  delete xlsxOptions.defaultValue
  delete xlsxOptions.plugins

  // パースする
  const readOptions = { cellDates: true }
  const wb = node.absolutePath
    ? XLSX.readFile(node.absolutePath, readOptions)
    : XLSX.read(await loadNodeContent(node), { type: `binary`, ...readOptions })
  wb.SheetNames.forEach((n, idx) => {
    const ws = wb.Sheets[n]
    const parsedContent = XLSX.utils.sheet_to_json(ws, xlsxOptions)

    if (_.isArray(parsedContent)) {
      const csvArray = parsedContent.map((obj, i) => {
        const contentDigest = createContentDigest(obj)
        return {
          ...obj,
          id: obj.id
            ? obj.id
            : createNodeId(`${node.id} [${n} ${i}] >>> ${node.extension}`),
          children: [],
          parent: node.id,
          internal: {
            contentDigest,
            type:
              _.upperFirst(_.camelCase(`${node.name} ${node.extension}`)) +
              `__` +
              _.upperFirst(_.camelCase(`${n}`)),
          },
        }
      })

      _.each(csvArray, y => {
        createNode(y)
        createParentChildLink({ parent: node, child: y })
      })

      const shObj = { name: n, idx: idx }
      const contentDigest = createContentDigest(shObj)
      const z = {
        id: createNodeId(`${node.id} [${idx}] >>> ${node.extension}`),
        children: [],
        parent: node.id,
        internal: {
          contentDigest,
          type: _.upperFirst(_.camelCase(`${node.name} ${node.extension}`)),
        },
      }
      createNode(z)
      createParentChildLink({ parent: node, child: z })
    }
  })

  return
}

exports.shouldOnCreateNode = shouldOnCreateNode
exports.onCreateNode = onCreateNode
