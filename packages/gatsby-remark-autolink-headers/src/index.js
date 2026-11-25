const { toString } = require(`mdast-util-to-string`)
const { visit } = require(`unist-util-visit`)
// github-slugger 2 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: GithubSlugger } = require(`github-slugger`)
const deburr = require(`lodash/deburr`)

const slugs = new GithubSlugger()

function patch(context, key, value) {
  if (!context[key]) {
    context[key] = value
  }

  return context[key]
}

const svgIcon = `<svg aria-hidden="true" focusable="false" height="16" version="1.1" viewBox="0 0 16 16" width="16"><path fill-rule="evenodd" d="M4 9h1v1H4c-1.5 0-3-1.69-3-3.5S2.55 3 4 3h4c1.45 0 3 1.69 3 3.5 0 1.41-.91 2.72-2 3.25V8.59c.58-.45 1-1.27 1-2.09C10 5.22 8.98 4 8 4H4c-.98 0-2 1.22-2 2.5S3 9 4 9zm9-3h-1v1h1c1 0 2 1.22 2 2.5S13.98 12 13 12H9c-.98 0-2-1.22-2-2.5 0-.83.42-1.64 1-2.09V6.25c-1.09.53-2 1.84-2 3.25C6 11.31 7.55 13 9 13h4c1.45 0 3-1.69 3-3.5S14.5 6 13 6z"></path></svg>`

module.exports = (
  { markdownAST },
  {
    icon = svgIcon,
    className = `anchor`,
    maintainCase = false,
    removeAccents = false,
    enableCustomId = false,
    isIconAfterHeader = false,
    elements = null,
  }
) => {
  slugs.reset()

  visit(markdownAST, `heading`, node => {
    // elements の配列がある場合は、配列に含まれない見出しの種類にはリンクを作成しない
    if (Array.isArray(elements) && !elements.includes(`h${node.depth}`)) {
      return
    }

    let id
    if (enableCustomId && node.children.length > 0) {
      const last = node.children[node.children.length - 1]
      // この正規表現は、文字列の末尾にある {#custom-id} と、その前の空白に一致する。
      // また、{#custom-id} を取り除いた後にノードのテキストが空にならないことも確認する。
      const match = /^(.*?)\s*\{#([\w-]+)\}$/.exec(toString(last))
      if (match && (match[1] || node.children.length > 1)) {
        id = match[2]
        // 元のテキストからカスタム ID を取り除く。
        if (match[1]) {
          last.value = match[1]
        } else {
          node.children.pop()
        }
      }
    }
    if (!id) {
      const slug = slugs.slug(toString(node), maintainCase)
      id = removeAccents ? deburr(slug) : slug
    }
    const data = patch(node, `data`, {})

    patch(data, `id`, id)
    patch(data, `htmlAttributes`, {})
    patch(data, `hProperties`, {})
    patch(data.htmlAttributes, `id`, id)
    patch(data.hProperties, `id`, id)

    if (icon !== false) {
      patch(data.hProperties, `style`, `position:relative;`)
      const label = id.split(`-`).join(` `)
      const method = isIconAfterHeader ? `push` : `unshift`
      node.children[method]({
        type: `link`,
        url: `#${id}`,
        title: null,
        children: [],
        data: {
          hProperties: {
            "aria-label": `${label} permalink`,
            class: `${className} ${isIconAfterHeader ? `after` : `before`}`,
          },
          hChildren: [
            {
              type: `raw`,
              // デフォルトは Octicon の link アイコンである。ただし、ユーザーは "icon" オプションで独自のアイコンを設定できる。
              value: icon,
            },
          ],
        },
      })
    }
  })

  return markdownAST
}
