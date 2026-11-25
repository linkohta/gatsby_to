const { visit } = require(`unist-util-visit`)
const cheerio = require(`cheerio`)
const { oneLine } = require(`common-tags`)
const _ = require(`lodash`)

const needsSemicolon = str => !str.endsWith(`;`)

/**
 * % の値を除き、あらゆるものを数値に変換する。
 * 他の値（em、vw など）を確認する必要はない。
 * ブラウザはいずれにせよ px として扱うためである。
 * @param {*} n 数値に変換する対象
 * @returns {number}
 */
const convert = n =>
  typeof n === `string` && n.trim().endsWith(`%`) ? NaN : parseInt(n, 10)

/**
 * 渡されたすべての引数が有効な数値かどうかを確認する
 * @param  {...number} args 確認する寸法
 * @returns {boolean}
 */
const isValidDimensions = (...args) => args.every(n => _.isFinite(n))

module.exports = async ({ markdownAST }, pluginOptions = {}) => {
  const defaults = {
    wrapperStyle: ``,
  }
  const options = _.defaults({}, pluginOptions, defaults)
  visit(markdownAST, [`html`, `jsx`], node => {
    const $ = cheerio.load(node.value)
    const iframe = $(`iframe, object`)
    if (iframe.length === 0) {
      return
    }

    const width = convert(iframe.attr(`width`))
    const height = convert(iframe.attr(`height`))
    if (!isValidDimensions(width, height)) {
      return
    }

    let fullStyle = $(`iframe`).attr(`style`) || `` // 他のプラグインが border: 0 を設定していることがある
    // そのため、既存のスタイルを確実に維持する。height や width など、
    // 他のスタイルがすでに定義されていても、いずれにせよ上書きされる。

    if (fullStyle.length > 0 && needsSemicolon(fullStyle)) {
      fullStyle = `${fullStyle};`
    }

    $(`iframe, object`)
      .attr(
        `style`,
        `${fullStyle}
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      `
      )
      .attr(`width`, null)
      .attr(`height`, null)

    const newIframe = $(`body`).html() // cheerio v1 向けの修正

    // TODO: youtube のプレビュー画像を background-image として追加する。

    const rawHTML = oneLine`
      <div
        class="gatsby-resp-iframe-wrapper"
        style="padding-bottom: ${
          (height / width) * 100
        }%; position: relative; height: 0; overflow: hidden;
        ${options.wrapperStyle}"
      >
        ${newIframe}
      </div>
    `

    node.type = `html`
    node.value = rawHTML
  })

  return markdownAST
}
