const fs = require(`fs`)
const path = require(`path`)

const distDirectory = path.join(__dirname, `..`, `..`, `dist`)

describe(`gatsby-graphiql-explorer`, () => {
  let routes
  let graphiqlExplorer

  beforeEach(() => {
    jest
      .spyOn(fs, `readdirSync`)
      .mockReturnValue([`app.js`, `index.html`, `123.abcdef.js`, `font.ttf`])
    jest.isolateModules(() => {
      graphiqlExplorer = require(`../../index`)
    })

    routes = {}
    const expressApp = {
      get: (route, handler) => {
        routes[route] = handler
      },
    }
    graphiqlExplorer(expressApp, {
      graphqlEndpoint: `/___graphql`,
      getFragments: () => [`fragment`],
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const createResponse = () => {
    return { set: jest.fn(), sendFile: jest.fn(), json: jest.fn() }
  }

  it(`serves the page, the bundle and the fragments`, () => {
    const page = createResponse()
    routes[`/___graphql`]({}, page)
    expect(page.sendFile).toHaveBeenCalledWith(
      path.join(distDirectory, `index.html`)
    )

    const bundle = createResponse()
    routes[`/___graphql/app.js`]({}, bundle)
    expect(bundle.sendFile).toHaveBeenCalledWith(
      path.join(distDirectory, `app.js`)
    )

    const fragments = createResponse()
    routes[`/___graphql/fragments`]({}, fragments)
    expect(fragments.json).toHaveBeenCalledWith([`fragment`])
  })

  it(`serves the chunks that exist in dist`, () => {
    const res = createResponse()
    const next = jest.fn()
    routes[`/___graphql/:file`](
      { params: { file: `123.abcdef.js` } },
      res,
      next
    )

    expect(res.set).toHaveBeenCalledWith(
      `Cache-Control`,
      `public, max-age=31557600`
    )
    expect(res.sendFile).toHaveBeenCalledWith(
      path.join(distDirectory, `123.abcdef.js`)
    )
    expect(next).not.toHaveBeenCalled()
  })

  it(`passes requests for unknown files to the next handler`, () => {
    for (const file of [`fragments`, `nope.js`, `../package.json`]) {
      const res = createResponse()
      const next = jest.fn()
      routes[`/___graphql/:file`]({ params: { file } }, res, next)

      expect(res.sendFile).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    }
  })
})
