const React = require(`react`)
const path = require(`path`)
const { renderToStaticMarkup, renderToPipeableStream } = require(
  `react-dom/server`
)
const { ServerLocation, Router, isRedirect } = require(`@gatsbyjs/reach-router`)
const merge = require(`deepmerge`)
const { StaticQueryContext } = require(`gatsby`)
const fs = require(`fs`)
const { WritableAsPromise } = require(`./server-utils/writable-as-promise`)

const { RouteAnnouncerProps } = require(`./route-announcer-props`)
const { apiRunner, apiRunnerAsync } = require(`./api-runner-ssr`)
const asyncRequires = require(`$virtual/async-requires`)
const { version: gatsbyVersion } = require(`gatsby/package.json`)
const { grabMatchParams } = require(`./find-path`)
const { headHandlerForSSR } = require(`./head/head-export-handler-for-ssr`)
const {
  SlicesResultsContext,
  SlicesContext,
  SlicesMapContext,
  SlicesPropsContext,
} = require(`./slice/context`)
const { ServerSliceRenderer } = require(`./slice/server-slice-renderer`)

// posix 形式での結合を強制し、Windows で URL にバックスラッシュが入らないようにする
const { join } = path.posix

const testRequireError = (moduleName, err) => {
  const regex = new RegExp(`Error: Cannot find module\\s.${moduleName}`)
  const firstLine = err.toString().split(`\n`)[0]
  return regex.test(firstLine)
}

let Html
try {
  Html = require(`../src/html`)
} catch (err) {
  if (testRequireError(`../src/html`, err)) {
    Html = require(`./default-html`)
  } else {
    throw err
  }
}

Html = Html && Html.__esModule ? Html.default : Html

const getPageDataPath = path => {
  const fixedPagePath = path === `/` ? `index` : path
  return join(`page-data`, fixedPagePath, `page-data.json`)
}

const createElement = React.createElement

export const sanitizeComponents = components => {
  const componentsArray = [].concat(components).flat(Infinity).filter(Boolean)

  return componentsArray.map(component => {
    // assetPrefix を使っている場合でも、マニフェストがアセットサーバーではなく
    // 常にコンテンツサーバーから読み込まれるようにする
    if (__ASSET_PREFIX__ && component.props.rel === `manifest`) {
      return React.cloneElement(component, {
        href: component.props.href.replace(__ASSET_PREFIX__, ``),
      })
    }
    return component
  })
}

function deepMerge(a, b) {
  const combineMerge = (target, source, options) => {
    const destination = target.slice()

    source.forEach((item, index) => {
      if (typeof destination[index] === `undefined`) {
        destination[index] = options.cloneUnlessOtherwiseSpecified(
          item,
          options
        )
      } else if (options.isMergeableObject(item)) {
        destination[index] = merge(target[index], item, options)
      } else if (target.indexOf(item) === -1) {
        destination.push(item)
      }
    })
    return destination
  }

  return merge(a, b, { arrayMerge: combineMerge })
}

/**
headComponents を並べ替え、meta タグが常に先頭に来るようにする。大きなインラインスタイルなどで下へ押しやられて、クローラーに見落とされないようにするためである。
@see https://github.com/gatsbyjs/gatsby/issues/22206
*/
export const reorderHeadComponents = headComponents => {
  const sorted = headComponents.sort((a, b) => {
    if (a.type && a.type === `meta` && !(b.type && b.type === `meta`)) {
      return -1
    }
    return 0
  })

  return sorted
}

const DEFAULT_CONTEXT = {
  // 現在サイトをビルド中かどうか
  // 元のビルドなのかエンジンなのかを判定するために使う
  isDuringBuild: false,
}

export default async function staticPage({
  pagePath,
  pageData,
  staticQueryContext,
  styles,
  scripts,
  reversedStyles,
  reversedScripts,
  inlinePageData = false,
  context = {},
  webpackCompilationHash,
  sliceData,
}) {
  const renderContext = Object.assign(DEFAULT_CONTEXT, context)

  // これが機能するには、この関数が同期的であるか、少なくとも同時に 1 つしか実行されないことを保証する必要がある
  global.unsafeBuiltinUsage = []

  try {
    let bodyHtml = ``
    let headComponents = [
      <meta
        name="generator"
        content={`Gatsby ${gatsbyVersion}`}
        key={`generator-${gatsbyVersion}`}
      />,
    ]
    let htmlAttributes = {}
    let bodyAttributes = {}
    let preBodyComponents = []
    let postBodyComponents = []
    let bodyProps = {}

    function loadPageDataSync(_pagePath) {
      if (_pagePath === pagePath) {
        // 現在のページの pageData を要求している場合は、fs を使う必要はない
        return pageData
      }

      const pageDataPath = getPageDataPath(_pagePath)
      const pageDataFile = join(process.cwd(), `public`, pageDataPath)
      try {
        // 非推奨の通知
        const myErrorHolder = {
          name: `Usage of loadPageDataSync for page other than currently generated page disables incremental html generation in future builds`,
        }
        Error.captureStackTrace(myErrorHolder, loadPageDataSync)
        global.unsafeBuiltinUsage.push(myErrorHolder.stack)
        const pageDataJson = fs.readFileSync(pageDataFile)
        return JSON.parse(pageDataJson)
      } catch (error) {
        // ファイルが見つからなくてもエラーではない。ページデータがないだけである
        return null
      }
    }

    const replaceBodyHTMLString = body => {
      bodyHtml = body
    }

    const setHeadComponents = components => {
      headComponents = headComponents.concat(sanitizeComponents(components))
    }

    const setHtmlAttributes = attributes => {
      // TODO - ディープマージは削除すべきである
      htmlAttributes = deepMerge(htmlAttributes, attributes)
    }

    const setBodyAttributes = attributes => {
      // TODO - ディープマージは削除すべきである
      bodyAttributes = deepMerge(bodyAttributes, attributes)
    }

    const setPreBodyComponents = components => {
      preBodyComponents = preBodyComponents.concat(
        sanitizeComponents(components)
      )
    }

    const setPostBodyComponents = components => {
      postBodyComponents = postBodyComponents.concat(
        sanitizeComponents(components)
      )
    }

    const setBodyProps = props => {
      // TODO - ディープマージは削除すべきである
      bodyProps = deepMerge({}, bodyProps, props)
    }

    const getHeadComponents = () => headComponents

    const replaceHeadComponents = components => {
      headComponents = sanitizeComponents(components)
    }

    const getPreBodyComponents = () => preBodyComponents

    const replacePreBodyComponents = components => {
      preBodyComponents = sanitizeComponents(components)
    }

    const getPostBodyComponents = () => postBodyComponents

    const replacePostBodyComponents = components => {
      postBodyComponents = sanitizeComponents(components)
    }

    const { componentChunkName, slicesMap } = pageData
    const pageComponent = await asyncRequires.components[componentChunkName]()

    class RouteHandler extends React.Component {
      render() {
        const props = {
          ...this.props,
          ...pageData.result,
          params: {
            ...grabMatchParams(this.props.location.pathname),
            ...(pageData.result?.pageContext?.__params || {}),
          },
        }

        const pageElement = createElement(pageComponent.default, props)

        const wrappedPage = apiRunner(
          `wrapPageElement`,
          { element: pageElement, props },
          pageElement,
          ({ result }) => {
            return { element: result, props }
          }
        ).pop()

        return wrappedPage
      }
    }

    const routerElement = (
      <ServerLocation url={`${__BASE_PATH__}${pagePath}`}>
        <Router id="gatsby-focus-wrapper" baseuri={__BASE_PATH__}>
          <RouteHandler path="/*" />
        </Router>
        <div {...RouteAnnouncerProps} />
      </ServerLocation>
    )

    const sliceProps = {}

    let body = apiRunner(
      `wrapRootElement`,
      { element: routerElement, pathname: pagePath },
      routerElement,
      ({ result }) => {
        return { element: result, pathname: pagePath }
      }
    ).pop()

    const slicesContext = {
      // 現在ビルド中であれば、サーバー上にいることが分かる
      // そうでなければエンジンの中にいる
      renderEnvironment: renderContext.isDuringBuild ? `server` : `engines`,
    }
    if (process.env.GATSBY_SLICES) {
      // エンジンの中で実行している場合は、スライス名からコンポーネント、データ、コンテキストへの
      // マップを渡すために、body を結果のコンテキストで手動でラップする必要がある
      if (slicesContext.renderEnvironment === `engines`) {
        // 挙動を模倣するため、
        // ブラウザーで使っているものと同じ名前にしている
        const slicesDb = new Map()

        for (const sliceName of Object.values(slicesMap)) {
          const slice = sliceData[sliceName]
          const { default: SliceComponent } = await getPageChunk(slice)

          const sliceObject = {
            component: SliceComponent,
            sliceContext: slice.result.sliceContext,
            data: slice.result.data,
          }

          slicesDb.set(sliceName, sliceObject)
        }

        body = (
          <SlicesResultsContext.Provider value={slicesDb}>
            {body}
          </SlicesResultsContext.Provider>
        )
      }

      body = (
        <SlicesContext.Provider value={slicesContext}>
          <SlicesPropsContext.Provider value={sliceProps}>
            <SlicesMapContext.Provider value={slicesMap}>
              {body}
            </SlicesMapContext.Provider>
          </SlicesPropsContext.Provider>
        </SlicesContext.Provider>
      )
    }

    const bodyComponent = (
      <StaticQueryContext.Provider value={staticQueryContext}>
        {body}
      </StaticQueryContext.Provider>
    )

    // サイトまたはプラグインにページコンポーネントをレンダリングさせる。
    await apiRunnerAsync(`replaceRenderer`, {
      bodyComponent,
      replaceBodyHTMLString,
      setHeadComponents,
      setHtmlAttributes,
      setBodyAttributes,
      setPreBodyComponents,
      setPostBodyComponents,
      setBodyProps,
      pathname: pagePath,
      pathPrefix: __PATH_PREFIX__,
    })

    // 誰も引き受けなかった場合は、ここで処理する。
    if (!bodyHtml) {
      try {
        const writableStream = new WritableAsPromise()
        const { pipe } = renderToPipeableStream(bodyComponent, {
          onAllReady() {
            pipe(writableStream)
          },
          onError(error) {
            writableStream.destroy(error)
          },
        })

        bodyHtml = await writableStream
      } catch (e) {
        // @reach/router のリダイレクトエラーは無視する
        if (!isRedirect(e)) throw e
      }
    }

    apiRunner(`onRenderBody`, {
      setHeadComponents,
      setHtmlAttributes,
      setBodyAttributes,
      setPreBodyComponents,
      setPostBodyComponents,
      setBodyProps,
      pathname: pagePath,
      loadPageDataSync,
      bodyHtml,
      scripts,
      styles,
      pathPrefix: __PATH_PREFIX__,
    })

    // Head は onRenderBody の後に実行したい。Head による Html と Body の属性が、
    // onRenderBody によるグローバルな属性よりも優先されるようにするためである
    headHandlerForSSR({
      pageComponent,
      setHeadComponents,
      setHtmlAttributes,
      setBodyAttributes,
      staticQueryContext,
      pageData,
      pagePath,
    })

    reversedScripts.forEach(script => {
      // preload/prefetch 用の <link> のマジックコメントを追加する
      if (script.shouldGenerateLink) {
        headComponents.push(
          <link
            as="script"
            rel={script.rel}
            key={script.name}
            href={`${__PATH_PREFIX__}/${script.name}`}
          />
        )
      }
    })

    reversedStyles.forEach(style => {
      // プリフェッチすべきスタイルには <link> を追加する
      // それ以外は <style> タグとしてインライン化する

      if (style.rel === `prefetch`) {
        headComponents.push(
          <link
            as="style"
            rel={style.rel}
            key={style.name}
            href={`${__PATH_PREFIX__}/${style.name}`}
          />
        )
      } else {
        headComponents.unshift(
          <style
            data-href={`${__PATH_PREFIX__}/${style.name}`}
            data-identity={`gatsby-global-css`}
            dangerouslySetInnerHTML={{
              __html: style.content,
            }}
          />
        )
      }
    })

    // 現在のページのページメタデータを追加する
    const windowPageData = `/*<![CDATA[*/window.pagePath=${JSON.stringify(
      pagePath
    )};${
      process.env.GATSBY_SLICES
        ? ``
        : `window.___webpackCompilationHash="${webpackCompilationHash}";`
    }${
      inlinePageData ? `window.pageData=${JSON.stringify(pageData)};` : ``
    }/*]]>*/`

    postBodyComponents.push(
      <script
        key={`script-loader`}
        id={`gatsby-script-loader`}
        dangerouslySetInnerHTML={{
          __html: windowPageData,
        }}
      />
    )

    if (process.env.GATSBY_SLICES) {
      postBodyComponents.push(
        createElement(ServerSliceRenderer, {
          sliceId: `_gatsby-scripts`,
        })
      )
    } else {
      const chunkMapping = require(`../public/chunk-map.json`)
      // 以前の挙動に戻す
      // チャンクの対応関係のメタデータを追加する
      const scriptChunkMapping = `/*<![CDATA[*/window.___chunkMapping=${JSON.stringify(
        chunkMapping
      )};/*]]>*/`

      postBodyComponents.push(
        <script
          key={`chunk-mapping`}
          id={`gatsby-chunk-mapping`}
          dangerouslySetInnerHTML={{
            __html: scriptChunkMapping,
          }}
        />
      )

      let bodyScripts = []
      if (chunkMapping[`polyfill`]) {
        chunkMapping[`polyfill`].forEach(script => {
          const scriptPath = `${__PATH_PREFIX__}${script}`
          bodyScripts.push(
            <script key={scriptPath} src={scriptPath} noModule={true} />
          )
        })
      }

      // プリフェッチ済みのバンドルは取り除く。script タグとして追加すると、
      // 高い優先度での取得を強制してしまうためである。
      bodyScripts = bodyScripts.concat(
        scripts
          .filter(s => s.rel !== `prefetch`)
          .map(s => {
            const scriptPath = `${__PATH_PREFIX__}/${JSON.stringify(
              s.name
            ).slice(1, -1)}`
            return <script key={scriptPath} src={scriptPath} async />
          })
      )

      postBodyComponents.push(...bodyScripts)
    }

    headComponents = reorderHeadComponents(headComponents)

    apiRunner(`onPreRenderHTML`, {
      getHeadComponents,
      replaceHeadComponents,
      getPreBodyComponents,
      replacePreBodyComponents,
      getPostBodyComponents,
      replacePostBodyComponents,
      pathname: pagePath,
      pathPrefix: __PATH_PREFIX__,
    })

    let htmlElement = (
      <Html
        {...bodyProps}
        headComponents={headComponents}
        htmlAttributes={htmlAttributes}
        bodyAttributes={bodyAttributes}
        preBodyComponents={preBodyComponents}
        postBodyComponents={postBodyComponents}
        body={bodyHtml}
        path={pagePath}
      />
    )

    if (process.env.GATSBY_SLICES) {
      htmlElement = (
        <SlicesContext.Provider value={slicesContext}>
          {htmlElement}
        </SlicesContext.Provider>
      )
    }

    const html = `<!DOCTYPE html>${renderToStaticMarkup(htmlElement)}`

    return {
      html,
      unsafeBuiltinsUsage: global.unsafeBuiltinUsage,
      sliceData: sliceProps,
    }
  } catch (e) {
    e.unsafeBuiltinsUsage = global.unsafeBuiltinUsage
    throw e
  }
}

export function getPageChunk({ componentChunkName }) {
  return asyncRequires.components[componentChunkName]()
}

export { renderToPipeableStream } from "react-server-dom-webpack/writer.node.server"
export { StaticQueryContext, React }

export async function renderSlice({ slice, staticQueryContext, props = {} }) {
  const { default: SliceComponent } = await getPageChunk(slice)

  const slicesContext = {
    // スライスコンポーネントの中で <Slice /> プレースホルダーを使うことには、まだ対応していない
    // `<Slice />` が使われたときに意味のあるエラーを投げるよう、この renderEnvironemnt を設定する
    // ネストした `<Slice />` プレースホルダーに対応したら、`slices` の renderEnvironment は削除すべきである
    renderEnvironment: `slices`,
    sliceRoot: slice,
  }

  const sliceElement = (
    <SliceComponent sliceContext={slice.context} {...props} />
  )

  const sliceWrappedWithWrapRootElement = apiRunner(
    `wrapRootElement`,
    { element: sliceElement },
    sliceElement,
    ({ result }) => {
      return { element: result }
    }
  ).pop()

  const sliceWrappedWithWrapRootElementAndContexts = (
    <SlicesContext.Provider value={slicesContext}>
      <StaticQueryContext.Provider value={staticQueryContext}>
        {sliceWrappedWithWrapRootElement}
      </StaticQueryContext.Provider>
    </SlicesContext.Provider>
  )

  const writableStream = new WritableAsPromise()
  const { pipe } = renderToPipeableStream(
    sliceWrappedWithWrapRootElementAndContexts,
    {
      onAllReady() {
        pipe(writableStream)
      },
      onError(error) {
        writableStream.destroy(error)
      },
    }
  )

  return await writableStream
}
