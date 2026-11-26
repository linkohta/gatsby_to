import React from "react"
const { onRenderBody } = require(`../gatsby-ssr`)

it(`does not crash when no pluginConfig is provided`, () => {
  const mocks = {
    setHeadComponents: () => null,
    setPostBodyComponents: () => null,
  }

  const pluginOptions = {
    trackingIds: [`GA_TRACKING_ID`],
  }
  onRenderBody(mocks, pluginOptions)
})

const DO_NOT_TRACK_STRING = `!(navigator.doNotTrack == "1" || window.doNotTrack == "1")`

it(`adds a preconnect link for Google Tag Manager`, () => {
  const mocks = {
    setHeadComponents: jest.fn(),
    setPostBodyComponents: jest.fn(),
  }
  const pluginOptions = {
    trackingIds: [`GA_TRACKING_ID`],
    pluginConfig: {},
  }

  onRenderBody(mocks, pluginOptions)
  const [link] = mocks.setHeadComponents.mock.calls[0][0]

  expect(link).toEqual(
    <link
      rel="preconnect"
      key="preconnect-google-gtag"
      href="https://www.googletagmanager.com"
    />,
    <link
      rel="dns-prefetch"
      key="dns-prefetch-google-gtag"
      href="https://www.googletagmanager.com"
    />
  )
})

describe(`respectDNT`, () => {
  it(`defaults respectDNT option to false`, () => {
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }
    const pluginOptions = {
      trackingIds: [`GA_TRACKING_ID`],
      pluginConfig: {},
    }

    onRenderBody(mocks, pluginOptions)
    const [, config] = mocks.setPostBodyComponents.mock.calls[0][0]

    expect(config.props.dangerouslySetInnerHTML.__html).not.toContain(
      DO_NOT_TRACK_STRING
    )
  })

  it(`listens to respectDNT option`, () => {
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }
    const pluginOptions = {
      trackingIds: [`GA_TRACKING_ID`],
      pluginConfig: {
        respectDNT: true,
      },
    }

    onRenderBody(mocks, pluginOptions)
    const [, config] = mocks.setPostBodyComponents.mock.calls[0][0]

    expect(config.props.dangerouslySetInnerHTML.__html).toContain(
      DO_NOT_TRACK_STRING
    )
  })
})

describe(`selfHostedOrigin`, () => {
  it(`should set selfHostedOrigin as googletagmanager.com by default`, () => {
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }
    const pluginOptions = {
      trackingIds: [`GA_TRACKING_ID`],
    }

    onRenderBody(mocks, pluginOptions)
    const [bodyConfig] = mocks.setPostBodyComponents.mock.calls[0][0]
    const headConfig = mocks.setHeadComponents.mock.calls[0][0]

    expect(bodyConfig.props.src).toContain(`https://www.googletagmanager.com`)
    expect(headConfig[0].props.href).toContain(
      `https://www.googletagmanager.com`
    )
    expect(headConfig[1].props.href).toContain(
      `https://www.googletagmanager.com`
    )
  })

  it(`should set selfHostedOrigin`, () => {
    const origin = `YOUR_SELF_HOSTED_ORIGIN`
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }
    const pluginOptions = {
      trackingIds: [`GA_TRACKING_ID`],
      pluginConfig: {
        origin: origin,
      },
    }

    onRenderBody(mocks, pluginOptions)
    const [bodyConfig] = mocks.setPostBodyComponents.mock.calls[0][0]
    const headConfig = mocks.setHeadComponents.mock.calls[0][0]

    expect(bodyConfig.props.src).toContain(origin)
    expect(headConfig[0].props.href).toContain(origin)
    expect(headConfig[1].props.href).toContain(origin)
  })
})

describe(`exclude`, () => {
  const getExcludedPaths = exclude => {
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }
    const pluginOptions = {
      trackingIds: [`GA_TRACKING_ID`],
      pluginConfig: { exclude },
    }

    onRenderBody(mocks, pluginOptions)
    const [, config] = mocks.setPostBodyComponents.mock.calls[0][0]
    const [, source] = config.props.dangerouslySetInnerHTML.__html.match(
      /window\.excludeGtagPaths=(\[.*?\]);/
    )
    // インラインスクリプトに書き出された正規表現を、ブラウザと同じように評価して確かめる
    const excludeGtagPaths = new Function(`return ${source}`)()

    return pathname => excludeGtagPaths.some(rx => rx.test(pathname))
  }

  it(`does not write excluded paths when the option is not set`, () => {
    const mocks = {
      setHeadComponents: jest.fn(),
      setPostBodyComponents: jest.fn(),
    }

    onRenderBody(mocks, { trackingIds: [`GA_TRACKING_ID`], pluginConfig: {} })
    const [, config] = mocks.setPostBodyComponents.mock.calls[0][0]

    expect(config.props.dangerouslySetInnerHTML.__html).not.toContain(
      `excludeGtagPaths`
    )
  })

  it(`writes excluded paths as regular expressions that match the paths`, () => {
    const isExcluded = getExcludedPaths([
      `/preview/**`,
      `/do-not-track/me/too/`,
    ])

    expect(isExcluded(`/preview`)).toBe(true)
    expect(isExcluded(`/preview/`)).toBe(true)
    expect(isExcluded(`/preview/a/b/`)).toBe(true)
    expect(isExcluded(`/do-not-track/me/too/`)).toBe(true)
    expect(isExcluded(`/do-not-track/me/too`)).toBe(false)
    expect(isExcluded(`/previews/`)).toBe(false)
    expect(isExcluded(`/`)).toBe(false)
  })

  it(`does not let a single-segment wildcard match a trailing slash or deeper paths`, () => {
    const isExcluded = getExcludedPaths([`/blog/*`])

    expect(isExcluded(`/blog/a`)).toBe(true)
    expect(isExcluded(`/blog/a/`)).toBe(false)
    expect(isExcluded(`/blog/a/b`)).toBe(false)
    expect(isExcluded(`/blog/`)).toBe(false)
  })
})
