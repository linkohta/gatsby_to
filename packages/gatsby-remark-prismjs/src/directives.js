const rangeParser = require(`parse-numeric-range`)

/**
 * この時点でコードはすでに prism でハイライトされているので、
 * JSX の開始コメント:
 *     {/*
 * は次のようになる:
 *     <span class="token punctuation">{</span><span class="token comment">/*
 * また、HTML の開始コメント:
 *     <!--
 * は次のようになる:
 *     &lt;!--
 */
const HIGHLIGHTED_JSX_COMMENT_START = `<span class="token punctuation">\\{<\\/span><span class="token comment">\\/\\*`
const HIGHLIGHTED_JSX_COMMENT_END = `\\*\\/<\\/span><span class="token punctuation">\\}</span>`
const HIGHLIGHTED_HTML_COMMENT_START = `&lt;!--`

const PRISMJS_COMMENT_OPENING_SPAN_TAG = `(<span\\sclass="token\\scomment">)?`
const PRISMJS_COMMENT_CLOSING_SPAN_TAG = `(<\\/span>)?`

const COMMENT_START = new RegExp(
  `(#|\\/\\/|\\{\\/\\*|\\/\\*+|${HIGHLIGHTED_HTML_COMMENT_START})`
)

const createDirectiveRegExp = featureSelector =>
  new RegExp(`${featureSelector}-(next-line|line|start|end|range)({([^}]+)})?`)

const COMMENT_END = new RegExp(`(-->|\\*\\/\\}|\\*\\/)?`)
const DIRECTIVE = createDirectiveRegExp(`(highlight|hide)`)
const HIGHLIGHT_DIRECTIVE = createDirectiveRegExp(`highlight`)

const END_DIRECTIVE = {
  highlight: /highlight-end/,
  hide: /hide-end/,
}

const MULTILINE_TOKEN_SPAN = /<span class="token ([^"]+)">[^<]*\n[^<]*<\/span>/g

const stripComment = line =>
  /**
   * この正規表現は次のことを行う:
   * 1. コメントの開始と、それに伴う PrismJS のコメント開始の span タグに一致する。
   * 2. いずれかのディレクティブに一致する。
   * 3. コメントの終了と、それに伴う PrismJS の終了の span タグに一致する。
   */
  line.replace(
    new RegExp(
      `\\s*(${HIGHLIGHTED_JSX_COMMENT_START}|${PRISMJS_COMMENT_OPENING_SPAN_TAG}${COMMENT_START.source})\\s*${DIRECTIVE.source}\\s*(${HIGHLIGHTED_JSX_COMMENT_END}|${COMMENT_END.source}${PRISMJS_COMMENT_CLOSING_SPAN_TAG})`
    ),
    ``
  )

const highlightWrap = line =>
  [`<span class="gatsby-highlight-code-line">`, line, `</span>`].join(``)
// const wrapAndStripComment = line => wrap(stripComment(line))

const parseLine = (line, code, index, actions) => {
  const [, feature, directive, directiveRange] = line.match(DIRECTIVE)
  const flagSource = {
    feature,
    index,
    directive: `${feature}-${directive}${directiveRange}`,
  }
  switch (directive) {
    case `next-line`:
      actions.flag(feature, index + 1, flagSource)
      actions.hide(index)
      break
    case `start`: {
      // 次の行から始めて、次の `${feature}-end` ディレクティブを見つける
      const endIndex = code.findIndex(
        (line, idx) => idx > index && END_DIRECTIVE[feature].test(line)
      )

      const end = endIndex === -1 ? code.length : endIndex

      actions.hide(index)
      actions.hide(end)

      for (let i = index + 1; i < end; i++) {
        actions.flag(feature, i, flagSource)
      }
      break
    }
    case `line`:
      actions.flag(feature, index, flagSource)
      actions.stripComment(index)
      break
    case `range`:
      actions.hide(index)

      if (directiveRange) {
        const strippedDirectiveRange = directiveRange.slice(1, -1)
        const range = rangeParser(strippedDirectiveRange)
        if (range.length > 0) {
          range.forEach(relativeIndex => {
            actions.flag(feature, index + relativeIndex, flagSource)
          })
          break
        }
      }

      console.warn(`Invalid match specified: "${line.trim()}"`)
      break
  }
}

module.exports = function highlightLineRange(code, highlights = []) {
  if (highlights.length > 0 || HIGHLIGHT_DIRECTIVE.test(code)) {
    // HACK: 行区切りを含む複数行の span を、行区切りで区切った複数の span に
    // 分割する。これにより、次のものに対する行のハイライトの挙動が直る
    //  - jsx の plain-text、
    //  - python の tripple-quoted-string、
    //  - c 系の言語（javascript を含む）の comment など。
    code = code.replace(MULTILINE_TOKEN_SPAN, (match, token) =>
      match.replace(/\n/g, `</span>\n<span class="token ${token}">`)
    )
  }

  const split = code.split(`\n`)
  const lines = split.map(code => {
    return { code, highlight: false, hide: false, flagSources: [] }
  })

  const actions = {
    flag: (feature, line, flagSource) => {
      if (line >= 0 && line < lines.length) {
        const lineMeta = lines[line]
        lineMeta[feature] = true
        lineMeta.flagSources.push(flagSource)
      }
    },
    hide: line => actions.flag(`hide`, line),
    highlight: line => actions.flag(`highlight`, line),
    stripComment: line => {
      lines[line].code = stripComment(lines[line].code)
    },
  }

  const transform = lines =>
    lines
      .filter(({ hide, highlight, flagSources }, index) => {
        if (hide && highlight) {
          const formattedSources = flagSources
            .map(
              ({ feature, index, directive }) =>
                `  - Line ${index + 1}: ${feature} ("${directive}")`
            )
            .join(`\n`)
          throw Error(
            `Line ${
              index + 1
            } has been marked as both hidden and highlighted.\n${formattedSources}`
          )
        }

        return !hide
      })
      .map(line => {
        if (line.highlight) {
          line.code = highlightWrap(line.code)
        }
        return line
      })

  // 言語の宣言と一緒にハイライトの範囲が渡された場合、たとえば
  // ``jsx{1, 3-4}
  // の場合は、それだけを使い、ハイライトのディレクティブはパースしない
  if (highlights.length > 0) {
    highlights.forEach(lineNumber => {
      actions.highlight(lineNumber - 1)
    })
    return transform(lines)
  }

  for (let i = 0; i < split.length; i++) {
    const line = split[i]
    if (DIRECTIVE.test(line)) {
      parseLine(line, split, i, actions)
    }
  }

  return transform(lines)
}
