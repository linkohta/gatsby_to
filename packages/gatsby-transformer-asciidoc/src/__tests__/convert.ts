// asciidoctor をモックせずに、実際の変換結果とメタデータの取り出しを確認する
import * as asciidoc from "asciidoctor"
import { onCreateNode } from "../gatsby-node"

const content = `= Document Title: The Subtitle
Jane Q Doe <jane@example.com>
v1.2, 2026-01-02: A remark
:page-category: docs

Preamble with *bold* text.

== Section One

image::photo.png[A photo]

|===
|A |B

|1 |2
|===
`

const createAsciidocNode = async (
  source: string = content,
  pluginOptions: Record<string, unknown> = {},
  pathPrefix?: string
): Promise<Record<string, unknown>> => {
  const createNode = jest.fn()
  await onCreateNode(
    {
      node: { id: `file`, extension: `adoc`, dir: __dirname },
      actions: { createNode, createParentChildLink: jest.fn() },
      pathPrefix,
      loadNodeContent: jest.fn(() => source),
      createNodeId: jest.fn(id => id),
      createContentDigest: jest.fn(() => `digest`),
      reporter: {
        panicOnBuild: jest.fn(message => {
          throw new Error(message)
        }),
      },
    },
    pluginOptions
  )
  return createNode.mock.calls[0][0]
}

describe(`gatsby-transformer-asciidoc with asciidoctor`, () => {
  it(`converts the document and extracts its metadata`, async () => {
    const node = await createAsciidocNode()

    expect(node.html).toMatchInlineSnapshot(`
      "<div id=\\"preamble\\">
      <div class=\\"sectionbody\\">
      <div class=\\"paragraph\\">
      <p>Preamble with <strong>bold</strong> text.</p>
      </div>
      </div>
      </div>
      <div class=\\"sect1\\">
      <h2 id=\\"_section_one\\">Section One</h2>
      <div class=\\"sectionbody\\">
      <div class=\\"imageblock\\">
      <div class=\\"content\\">
      <img src=\\"/images/photo.png\\" alt=\\"A photo\\">
      </div>
      </div>
      <table class=\\"tableblock frame-all grid-all stretch\\">
      <colgroup>
      <col width=\\"50%\\">
      <col width=\\"50%\\">
      </colgroup>
      <thead>
      <tr>
      <th class=\\"tableblock halign-left valign-top\\">A</th>
      <th class=\\"tableblock halign-left valign-top\\">B</th>
      </tr>
      </thead>
      <tbody>
      <tr>
      <td class=\\"tableblock halign-left valign-top\\"><p class=\\"tableblock\\">1</p></td>
      <td class=\\"tableblock halign-left valign-top\\"><p class=\\"tableblock\\">2</p></td>
      </tr>
      </tbody>
      </table>
      </div>
      </div>"
    `)
    expect(node.document).toEqual({
      title: `Document Title: The Subtitle`,
      subtitle: `The Subtitle`,
      main: `Document Title`,
    })
    expect(node.revision).toEqual({
      date: `2026-01-02`,
      number: `1.2`,
      remark: `A remark`,
    })
    expect(node.author).toEqual({
      fullName: `Jane Q Doe`,
      firstName: `Jane`,
      lastName: `Doe`,
      middleName: `Q`,
      authorInitials: `JQD`,
      email: `jane@example.com`,
    })
    expect(node.pageAttributes).toEqual({ category: `docs` })
  })

  it(`keeps the author object for a document without an author`, async () => {
    // asciidoctor 2 と同じく、著者がいなくても author は null にならない
    const node = await createAsciidocNode(`Just a paragraph.`)

    expect(node.author).toEqual({
      fullName: null,
      firstName: null,
      lastName: ``,
      middleName: ``,
      authorInitials: ``,
      email: ``,
    })
    expect(node.revision).toBeNull()
    expect(node.document).toEqual({ title: ``, subtitle: ``, main: `` })
  })

  it(`applies pathPrefix and the imagesdir attribute to image paths`, async () => {
    const node = await createAsciidocNode(
      content,
      { attributes: { imagesdir: `/assets@` } },
      `/prefix`
    )

    expect(node.html).toContain(`<img src="/prefix/assets/photo.png"`)
  })

  it(`uses a custom converter passed as converterFactory`, async () => {
    class CustomConverter {
      baseConverter = asciidoc.Html5Converter.create(`html5`)

      async convert(
        node: asciidoc.AbstractBlock,
        transform?: string
      ): Promise<unknown> {
        if (node.getNodeName() === `paragraph`) {
          return `<p class="custom">${await node.getContent()}</p>`
        }

        return this.baseConverter.convert(node, transform)
      }
    }

    try {
      const node = await createAsciidocNode(content, {
        converterFactory: CustomConverter,
      })

      expect(node.html).toContain(
        `<p class="custom">Preamble with <strong>bold</strong> text.</p>`
      )
    } finally {
      asciidoc.ConverterFactory.unregisterAll()
    }
  })
})
