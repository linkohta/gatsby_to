const { remark: createRemark } = require(`remark`)
const { find } = require(`unist-util-find`)
const _ = require(`lodash`)

const plugin = require(`../`)

const remark = createRemark().data(`settings`, {
  commonmark: true,
  footnotes: true,
  pedantic: true,
})

const extractObjectTag = mdast =>
  _.reduce(
    mdast.children[0].children,
    (result, child) => result + child.value,
    ``
  )

const extractIframeTag = mdast => mdast.children[0].value

describe(`gatsby-remark-responsive-iframe`, () => {
  ;[`iframe`, `object`].forEach(tag => {
    it(`transforms an ${tag} with unitless width and height`, async () => {
      const markdownAST = remark.parse(`
<${tag} url="http://www.example.com/" width="600" height="400"></${tag}>
    `)

      const transformed = await plugin({ markdownAST })
      const node = find(transformed, function (node) {
        return node.type === `html`
      })
      expect(node).toBeDefined()
      expect(node.value).toMatchSnapshot()
    })
  })
  ;[`iframe`, `object`].forEach(tag => {
    it(`transforms an ${tag} with pixel width and height`, async () => {
      const markdownAST = remark.parse(`
<${tag} url="http://www.example.com/" width="600px" height="400px"></${tag}>
    `)

      const transformed = await plugin({ markdownAST })
      const node = find(transformed, function (node) {
        return node.type === `html`
      })
      expect(node).toBeDefined()
      expect(node.value).toMatchSnapshot()
    })
    it(`transforms an ${tag} and maintains existing styles`, async () => {
      const markdownAST = remark.parse(`
<${tag} url="http://www.example.com/" style="border:0" width="600px" height="400px"></${tag}>
    `)

      const transformed = await plugin({ markdownAST })
      const node = find(transformed, function (node) {
        return node.type === `html`
      })
      expect(node).toBeDefined()
      expect(node.value).toMatchSnapshot()
    })
    it(`transforms an ${tag} and maintains existing styles when a semicolon exists`, async () => {
      const markdownAST = remark.parse(`
<${tag} url="http://www.example.com/" style="border:0;" width="600px" height="400px"></${tag}>
    `)

      const transformed = await plugin({ markdownAST })
      const node = find(transformed, function (node) {
        return node.type === `html`
      })
      expect(node).toBeDefined()
      expect(node.value).toMatchSnapshot()
    })
  })

  it(`can copy JSX images`, async () => {
    // MDX v1 の remark-mdx が作っていた `jsx` ノード（JSX の文字列を value に持つ）を再現する。
    // 現行の remark-mdx はこのノードを作らないので、手で組み立てる。
    const markdownAST = {
      type: `root`,
      children: [
        {
          type: `jsx`,
          value: `<iframe url="http://www.example.com/" style="border:0;" width="600px" height="400px"></iframe>`,
        },
      ],
    }

    const transformed = await plugin({ markdownAST })
    const node = find(transformed, function (node) {
      return node.type === `html`
    })

    expect(node).toBeDefined()
    expect(node.value).toMatchSnapshot()
  })

  const shouldntTransform = [
    [`100%`, `100`],
    [`100`, `100%`],
    [`invalid`, `100`],
    [`100`, `invalid`],
  ]

  _.map(shouldntTransform, ([width, height]) => {
    ;[`iframe`, `object`].forEach(tag => {
      it(`doesn't transform an ${tag} with dimensions: '${width}' '${height}'`, async () => {
        const markdownAST = remark.parse(`
  <${tag} url="http://www.example.com/" width="${width}" height="${height}"></${tag}>
      `)
        const transformed = await plugin({ markdownAST })
        // Note: Remark は iframe（ブロックレベル）と object（インライン）のタグを
        // 別々に扱い、object タグを <p></p> タグで包む。また、object タグを
        // 3 つの別々のノードにパースする。開始タグ用、終了タグ用、
        // 内側の改行用の 3 つである。そのため、プラグインから未変換のノードが
        // 返ってくるテストでは、p タグを取り除き、ノードを 1 つの html 文字列に
        // 結合している。
        if (tag === `iframe`) {
          const iframeHTML = extractIframeTag(transformed)
          expect(iframeHTML).toBeDefined()
          expect(iframeHTML).toMatchSnapshot()
        } else {
          const objectHTML = extractObjectTag(transformed)
          expect(objectHTML).toBeDefined()
          expect(objectHTML).toMatchSnapshot()
        }
      })
    })
  })
})
