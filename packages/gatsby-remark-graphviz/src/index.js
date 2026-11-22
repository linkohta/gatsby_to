const visit = require(`unist-util-visit`)
const Viz = require(`viz.js`)
const { Module, render } = require(`viz.js/full.render.js`)
const cheerio = require(`cheerio`)

const viz = new Viz({ Module, render })

const validLanguages = [`dot`, `circo`]

module.exports = async ({ markdownAST }, pluginOptions = {}) => {
  const codeNodes = []

  visit(markdownAST, `code`, node => {
    // graphviz が対応している言語だけを処理する
    if (validLanguages.includes(node.lang)) {
      codeNodes.push({ node, attrString: node.meta })
    }
    return node
  })

  await Promise.all(
    codeNodes.map(async ({ node, attrString }) => {
      const { value, lang } = node

      try {
        // 実際のレンダリングを行う
        const svgString = await viz.renderString(value, { engine: lang })

        // デフォルトのインラインスタイルを追加する
        const $ = cheerio.load(svgString)
        $(`svg`).attr(`style`, `max-width: 100%; height: auto;`)

        // ユーザーがカスタムの属性を指定していればマージする（追加と上書き）
        if (attrString) {
          const attrElement = cheerio.load(`<element ${attrString}></element>`)
          $(`svg`).attr(attrElement(`element`).attr())
        }

        // 現在のノードを書き換える。コードブロックから
        // （svg を内容とする）HTML へ変換する
        node.type = `html`
        node.value = $.html(`svg`)
      } catch (error) {
        console.log(
          `Error during viz.js execution. Leaving code block unchanged`
        )
        console.log(error)
      }

      return node
    })
  )
}
