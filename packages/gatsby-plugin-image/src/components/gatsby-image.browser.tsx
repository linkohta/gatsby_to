import {
  createElement,
  memo,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react"
import {
  getWrapperProps,
  gatsbyImageIsInstalled,
  hasNativeLazyLoadSupport,
} from "./hooks"
import { getSizer } from "./layout-wrapper"
import { propTypes } from "./gatsby-image.server"
import type {
  FC,
  ElementType,
  FunctionComponent,
  ImgHTMLAttributes,
  CSSProperties,
  ReactEventHandler,
} from "react"
import type { renderImageToString } from "./lazy-hydrate"
import type { PlaceholderProps } from "./placeholder"
import type { MainImageProps } from "./main-image"
import type { Layout } from "../image-utils"

const imageCache = new Set<string>()
let renderImageToStringPromise
let renderImage: typeof renderImageToString | undefined

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface GatsbyImageProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "placeholder" | "onLoad" | "src" | "srcSet" | "width" | "height"
  > {
  alt: string
  as?: ElementType
  className?: string
  class?: string
  imgClassName?: string
  image: IGatsbyImageData
  imgStyle?: CSSProperties
  backgroundColor?: string
  objectFit?: CSSProperties["objectFit"]
  objectPosition?: CSSProperties["objectPosition"]
  onLoad?: (props: { wasCached: boolean }) => void
  onError?: ReactEventHandler<HTMLImageElement>
  onStartLoad?: (props: { wasCached: boolean }) => void
}

export interface IGatsbyImageData {
  layout: Layout
  width: number
  height: number
  backgroundColor?: string
  images: Pick<MainImageProps, "sources" | "fallback">
  placeholder?: Pick<PlaceholderProps, "sources" | "fallback">
}

const GatsbyImageHydrator: FC<GatsbyImageProps> = function GatsbyImageHydrator({
  as = `div`,
  image,
  style,
  backgroundColor,
  className,
  class: preactClass,
  onStartLoad,
  onLoad,
  onError,
  ...props
}) {
  const { width, height, layout } = image
  const {
    style: wStyle,
    className: wClass,
    ...wrapperProps
  } = getWrapperProps(width, height, layout)
  const root = useRef<HTMLElement>()
  const cacheKey = useMemo(() => JSON.stringify(image.images), [image.images])

  // Preact は className ではなく class を使うので、両方を確認する必要がある
  if (preactClass) {
    className = preactClass
  }

  const sizer = getSizer(layout, width, height)

  // React 19 でのドキュメント化されていない挙動の変更を回避するため、この { __html } オブジェクトをメモ化する:
  // https://github.com/facebook/react/issues/31660.
  const dangerouslySetInnerHTML = useMemo(() => {
    return {
      __html: sizer,
    }
  }, [sizer])

  useEffect(() => {
    if (!renderImageToStringPromise) {
      renderImageToStringPromise = import(`./lazy-hydrate`).then(
        ({ renderImageToString, swapPlaceholderImage }) => {
          renderImage = renderImageToString

          return {
            renderImageToString,
            swapPlaceholderImage,
          }
        }
      )
    }

    // plugin image コンポーネントは少し特殊で、サーバーサイドレンダリングされた場合は、遅延読み込みに対応するための script タグを追加している
    // この場合はハイドレーションを止めるが、正しいイベントは発火させる。
    const ssrImage = root.current.querySelector(
      `[data-gatsby-image-ssr]`
    ) as HTMLImageElement
    if (ssrImage && hasNativeLazyLoadSupport()) {
      if (ssrImage.complete) {
        // onStartload と onLoad のイベントを発火させる
        onStartLoad?.({
          wasCached: true,
        })
        onLoad?.({
          wasCached: true,
        })

        // state の更新のために ssr のキーを取り除くが、gatsby-ssr のネイティブのコードスニペットと競合しないよう遅延を入れる
        setTimeout(() => {
          ssrImage.removeAttribute(`data-gatsby-image-ssr`)
        }, 0)
      } else {
        onStartLoad?.({
          wasCached: true,
        })

        ssrImage.addEventListener(`load`, function onLoadListener() {
          ssrImage.removeEventListener(`load`, onLoadListener)

          onLoad?.({
            wasCached: true,
          })
          // state の更新のために ssr のキーを取り除くが、gatsby-ssr のネイティブのコードスニペットと競合しないよう遅延を入れる
          setTimeout(() => {
            ssrImage.removeAttribute(`data-gatsby-image-ssr`)
          }, 0)
        })
      }

      imageCache.add(cacheKey)

      return
    }

    if (renderImage && imageCache.has(cacheKey)) {
      return
    }

    let animationFrame
    let cleanupCallback
    renderImageToStringPromise.then(
      ({ renderImageToString, swapPlaceholderImage }) => {
        if (!root.current) {
          return
        }

        root.current.innerHTML = renderImageToString({
          isLoading: true,
          isLoaded: imageCache.has(cacheKey),
          image,
          ...props,
        })

        if (!imageCache.has(cacheKey)) {
          animationFrame = requestAnimationFrame(() => {
            if (root.current) {
              cleanupCallback = swapPlaceholderImage(
                root.current,
                cacheKey,
                imageCache,
                style,
                onStartLoad,
                onLoad,
                onError
              )
            }
          })
        }
      }
    )

    // eslint-disable-next-line consistent-return
    return (): void => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
      if (cleanupCallback) {
        cleanupCallback()
      }
    }
  }, [image])

  // useLayoutEffect は、React が DOM へコミットする前に実行される。これにより、HTML がキャッシュ済みの画像を使うことを保証できる
  useLayoutEffect(() => {
    if (imageCache.has(cacheKey) && renderImage) {
      root.current.innerHTML = renderImage({
        isLoading: imageCache.has(cacheKey),
        isLoaded: imageCache.has(cacheKey),
        image,
        ...props,
      })

      // onStartload と onLoad のイベントを発火させる
      onStartLoad?.({
        wasCached: true,
      })
      onLoad?.({
        wasCached: true,
      })
    }
  }, [image])

  // すべての props を同じに保つことで、React はコンポーネントを DOM に残す
  return createElement(as, {
    ...wrapperProps,
    style: {
      ...wStyle,
      ...style,
      backgroundColor,
    },
    className: `${wClass}${className ? ` ${className}` : ``}`,
    ref: root,
    dangerouslySetInnerHTML,
    suppressHydrationWarning: true,
  })
}

export const GatsbyImage: FunctionComponent<GatsbyImageProps> = memo(
  function GatsbyImage(props) {
    if (!props.image) {
      if (process.env.NODE_ENV === `development`) {
        console.warn(`[gatsby-plugin-image] Missing image prop`)
      }

      return null
    }

    if (!gatsbyImageIsInstalled() && process.env.NODE_ENV === `development`) {
      console.warn(
        `[gatsby-plugin-image] You're missing out on some cool performance features. Please add "gatsby-plugin-image" to your gatsby-config.js`
      )
    }

    return createElement(GatsbyImageHydrator, props)
  }
)

GatsbyImage.propTypes = propTypes
GatsbyImage.displayName = `GatsbyImage`
