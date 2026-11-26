jest.mock(`gatsby-core-utils`)

const { isCI, createContentDigest } = require(`gatsby-core-utils`)
const createMockLogger = require(`logger-mock`)
const fetchRoutes = require(`../prepare/fetch-routes`)

describe(`fetch-routes`, () => {
  const endpoint = `http://localhost:3000/___graphql`
  let cache
  let logger
  let fetchSpy

  const mockResponse = (body, init = {}) =>
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": `application/json` },
          ...init,
        })
      )
    )

  const mockRoutes = paths =>
    mockResponse({
      data: {
        allSitePage: {
          nodes: paths.map(path => {
            return { path }
          }),
        },
      },
    })

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, `fetch`)
    cache = {
      timestamp: Date.now(),
      hash: `initial-run`,
      assets: {},
    }
    logger = createMockLogger()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it(`doesn't throw when no routes are present`, async () => {
    expect.assertions(2)

    mockRoutes([])

    const routes = await fetchRoutes({ logger, endpoint, cache })

    expect(fetchSpy).toHaveBeenCalled()
    expect(routes).toEqual([])
  })

  it(`sends the routes query to the endpoint as a JSON POST request`, async () => {
    mockRoutes([`/foo`])

    await fetchRoutes({ logger, endpoint, cache })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe(endpoint)
    expect(options.method).toBe(`POST`)
    expect(options.headers[`Content-Type`]).toBe(`application/json`)
    expect(JSON.parse(options.body).query).toContain(`allSitePage`)
  })

  it(`reports a connection error when the request fails`, async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.reject(new TypeError(`fetch failed`))
    )
    logger.fatal.mockImplementationOnce(() => {
      throw new Error(`fatal`)
    })

    await expect(fetchRoutes({ logger, endpoint, cache })).rejects.toThrow(
      `fatal`
    )
    expect(logger.fatal).toHaveBeenCalledWith(
      expect.stringContaining(`could not establish a connection`)
    )
  })

  it(`reports a connection error when the server responds with an HTTP error`, async () => {
    mockResponse({ message: `not found` }, { status: 404 })
    logger.fatal.mockImplementationOnce(() => {
      throw new Error(`fatal`)
    })

    await expect(fetchRoutes({ logger, endpoint, cache })).rejects.toThrow(
      `fatal`
    )
  })

  it(`reports a connection error when the response contains GraphQL errors`, async () => {
    mockResponse({ errors: [{ message: `Cannot query field "allSitePage"` }] })
    logger.fatal.mockImplementationOnce(() => {
      throw new Error(`fatal`)
    })

    await expect(fetchRoutes({ logger, endpoint, cache })).rejects.toThrow(
      `fatal`
    )
  })

  it(`generates an array of routes`, async () => {
    expect.assertions(1)

    mockRoutes([`/foo`, `/bar`, `/baz`])

    const routes = await fetchRoutes({ logger, endpoint, cache })

    expect(routes).toEqual([`/foo`, `/bar`, `/baz`])
  })

  it(`prompts the user when the list of routes has not changed since last run`, async () => {
    expect.assertions(1)

    mockRoutes([`/foo`, `/bar`, `/baz`])
    // ルートをクロールしない
    logger.confirm.mockImplementationOnce(() => Promise.resolve(false))
    createContentDigest.mockReturnValueOnce(cache.hash)

    await expect(fetchRoutes({ logger, endpoint, cache })).resolves.toEqual([])
  })

  it(`doesn't prompt the user when the list of routes has not changed since last run if run in CI`, async () => {
    expect.assertions(1)

    mockRoutes([`/foo`, `/bar`, `/baz`])

    cache.hash = `09f5b092fb87d859e0ac53dbae299a9e`
    createContentDigest.mockReturnValueOnce(cache.hash)
    isCI.mockReturnValueOnce(true)

    await expect(fetchRoutes({ logger, endpoint, cache })).resolves.toEqual([])
  })
})
