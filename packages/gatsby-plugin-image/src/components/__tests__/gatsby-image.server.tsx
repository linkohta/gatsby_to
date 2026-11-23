/**
 * @jest-environment jsdom
 */

import React from "react"
import { render, screen } from "@testing-library/react"
import { GatsbyImage } from "../gatsby-image.server"
import { IGatsbyImageData } from "../gatsby-image.browser"
import { SourceProps } from "../picture"

// babel プラグインの中ではないので、terser が bail しないようにする
jest.mock(
  `../../../macros/terser.macro`,
  () =>
    (strs): string =>
      strs.join(``)
)

describe(`GatsbyImage server`, () => {
  beforeEach(() => {
    console.warn = jest.fn()
    global.SERVER = true
    global.GATSBY___IMAGE = true
  })

  afterEach(() => {
    jest.clearAllMocks()
    global.SERVER = false
    global.GATSBY___IMAGE = false
  })

  it(`shows nothing when the image props is not passed`, () => {
    // image を渡さないときの typescript のエラーを消せるようにする
    // JavaScript を使っていて TS の型の恩恵を受けられない
    // ユーザーに役立つ
    const GatsbyImageAny = GatsbyImage as React.FC
    const { container } = render(<GatsbyImageAny />)

    // 実装の詳細を検証しているが、UX のためなので許容できるトレードオフである
    expect(console.warn).toHaveBeenCalledWith(
      `[gatsby-plugin-image] Missing image prop`
    )
    expect(container.firstChild).toBeNull()
  })

  describe(`style verifications`, () => {
    it(`has a valid className for fullWidth layout`, () => {
      const layout = `fullWidth`

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout,
        images: { sources: [] },
        placeholder: { sources: [] },
        sizes: `192x192`,
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const wrapper = document.querySelector(`[data-gatsby-image-wrapper=""]`)
      expect((wrapper as HTMLElement).className).toMatchInlineSnapshot(
        `"gatsby-image-wrapper"`
      )
    })

    it(`has a valid style attributes for fixed layout`, () => {
      const layout = `fixed`

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout,
        images: { sources: [] },
        placeholder: { sources: [] },
        sizes: `192x192`,
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const wrapper = document.querySelector(`[data-gatsby-image-wrapper=""]`)
      expect((wrapper as HTMLElement).style).toMatchInlineSnapshot(`
        Object {
          "0": "width",
          "1": "height",
        }
      `)
      // jsdom 26 以降は値がスナップショットに出力されないので、値は個別に確認する
      expect((wrapper as HTMLElement).style.width).toBe(`100px`)
      expect((wrapper as HTMLElement).style.height).toBe(`100px`)
    })

    it(`has a valid className for constrained layout`, () => {
      const layout = `constrained`

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout,
        images: { sources: [] },
        placeholder: { sources: [] },
        sizes: `192x192`,
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const wrapper = document.querySelector(`[data-gatsby-image-wrapper=""]`)
      expect((wrapper as HTMLElement).className).toMatchInlineSnapshot(
        `"gatsby-image-wrapper gatsby-image-wrapper-constrained"`
      )
    })
  })

  describe(`fallback verifications`, () => {
    it(`doesn't have an src or srcSet when fallback is not provided in images`, () => {
      // fallback が指定されていない
      const images = {}

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images,
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const img = screen.getByRole(`img`)
      expect(img).toMatchInlineSnapshot(`
        <img
          alt="A fake image for testing purpose"
          data-gatsby-image-ssr=""
          data-main-image=""
          decoding="async"
          loading="lazy"
          style="opacity: 0;"
        />
      `)
    })

    it(`has a valid src value when fallback is provided in images`, () => {
      const images = {
        fallback: { src: `some-src-fallback.jpg`, sizes: `192x192` },
      }

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images,
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const img = screen.getByRole(`img`)
      expect(img).toMatchInlineSnapshot(`
        <img
          alt="A fake image for testing purpose"
          data-gatsby-image-ssr=""
          data-main-image=""
          data-src="some-src-fallback.jpg"
          decoding="async"
          loading="lazy"
          sizes="192x192"
          style="opacity: 0;"
        />
      `)
    })

    it(`has a valid srcSet value when provided in the fallback prop of images`, () => {
      const images = {
        fallback: {
          src: `some-src-fallback.jpg`,
          srcSet: `icon32px.png 32w,
icon64px.png 64w,
icon-retina.png 2x,
icon-ultra.png 3x,
icon.svg`,
          sizes: `192x192`,
        },
      }

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images,
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const img = screen.getByRole(`img`)
      expect(img).toMatchInlineSnapshot(`
        <img
          alt="A fake image for testing purpose"
          data-gatsby-image-ssr=""
          data-main-image=""
          data-src="some-src-fallback.jpg"
          data-srcset="icon32px.png 32w,icon64px.png 64w,icon-retina.png 2x,icon-ultra.png 3x,icon.svg"
          decoding="async"
          loading="lazy"
          sizes="192x192"
          style="opacity: 0;"
        />
      `)
    })
  })

  describe(`sources verifications`, () => {
    it(`doesn't have an src or srcSet when sources is not provided in images`, () => {
      // fallback が指定されていない
      const images = {}

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images,
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const img = screen.getByRole(`img`)
      expect(img).toMatchInlineSnapshot(`
        <img
          alt="A fake image for testing purpose"
          data-gatsby-image-ssr=""
          data-main-image=""
          decoding="async"
          loading="lazy"
          style="opacity: 0;"
        />
      `)
    })

    it(`has valid sizes and srcSet when provided in the images`, () => {
      const sources: Array<SourceProps> = [
        {
          media: `some-media`,
          sizes: `192x192,56x56`,
          srcSet: `icon32px.png 32w,
icon64px.png 64w,
icon-retina.png 2x,
icon-ultra.png 3x,
icon.svg`,
        },
      ]

      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images: {
          sources,
          fallback: { src: `some-src-fallback.jpg`, sizes: `192x192` },
        },
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      const { container } = render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )

      const picture = container.querySelector(`picture`)

      expect(picture).toMatchInlineSnapshot(`
        <picture>
          <source
            data-srcset="icon32px.png 32w,icon64px.png 64w,icon-retina.png 2x,icon-ultra.png 3x,icon.svg"
            media="some-media"
            sizes="192x192"
          />
          <img
            alt="A fake image for testing purpose"
            data-gatsby-image-ssr=""
            data-main-image=""
            data-src="some-src-fallback.jpg"
            decoding="async"
            loading="lazy"
            sizes="192x192"
            style="opacity: 0;"
          />
        </picture>
      `)
    })
  })

  describe(`placeholder verifications`, () => {
    it(`has a placeholder in a div with valid styles for fullWidth layout`, () => {
      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `fullWidth`,
        images: {},
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      const { container } = render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )
      const placeholder = container.querySelector(`[data-placeholder-image=""]`)

      expect(placeholder).toMatchInlineSnapshot(`
        <div
          aria-hidden="true"
          data-placeholder-image=""
          sources=""
          style="opacity: 1; transition: opacity 500ms linear; background-color: red; position: absolute; top: 0px; left: 0px; bottom: 0px; right: 0px;"
        />
      `)
    })

    it(`has a placeholder in a div with valid styles for fixed layout`, () => {
      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `fixed`,
        images: {},
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      const { container } = render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )
      const placeholder = container.querySelector(`[data-placeholder-image=""]`)

      expect(placeholder).toMatchInlineSnapshot(`
        <div
          aria-hidden="true"
          data-placeholder-image=""
          sources=""
          style="opacity: 1; transition: opacity 500ms linear; background-color: red; width: 100px; height: 100px; position: relative;"
        />
      `)
    })

    it(`has a placeholder in a div with valid styles for constrained layout`, () => {
      const image: IGatsbyImageData = {
        width: 100,
        height: 100,
        layout: `constrained`,
        images: {},
        placeholder: { sources: [] },
        backgroundColor: `red`,
      }

      const { container } = render(
        <GatsbyImage image={image} alt="A fake image for testing purpose" />
      )
      const placeholder = container.querySelector(`[data-placeholder-image=""]`)

      expect(placeholder).toMatchInlineSnapshot(`
        <div
          aria-hidden="true"
          data-placeholder-image=""
          sources=""
          style="opacity: 1; transition: opacity 500ms linear; background-color: red; position: absolute; top: 0px; left: 0px; bottom: 0px; right: 0px;"
        />
      `)
    })
  })
})
