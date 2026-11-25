const { visit } = require(`unist-util-visit`)
const katex = require(`katex`)
const { default: remarkMath } = require(`remark-math`)
const { unified } = require(`unified`)
const { default: parse } = require(`rehype-parse`)
const { removePosition } = require(`unist-util-remove-position`)

// KaTeX が出力した HTML を hast のノードの配列にする。
// rehype-parse 9 には位置情報を付けないオプションがないので、パースした後で取り除く。
const parseHtml = html => {
  const tree = unified().use(parse, { fragment: true }).parse(html)
  removePosition(tree, { force: true })
  return tree.children
}

module.exports = ({ markdownAST }, pluginOptions = {}) => {
  // remark-math 6 は数式を `<code class="language-math">`（ブロックは `<pre>` の中）として出力する。
  // これまでの `<span class="math math-inline">` と `<div class="math math-display">` に合わせた CSS が
  // そのまま使えるように、要素名とクラスを remark-math 4 と同じものに上書きする。
  visit(markdownAST, `inlineMath`, node => {
    node.data.hName = `span`
    node.data.hProperties = { className: [`math`, `math-inline`] }
    node.data.hChildren = parseHtml(
      katex.renderToString(node.value, {
        displayMode: false,
        ...pluginOptions,
      })
    )
  })

  visit(markdownAST, `math`, node => {
    node.data.hName = `div`
    node.data.hProperties = { className: [`math`, `math-display`] }
    node.data.hChildren = parseHtml(
      katex.renderToString(node.value, {
        displayMode: true,
        ...pluginOptions,
      })
    )
  })
}

module.exports.setParserPlugins = () => [remarkMath]
