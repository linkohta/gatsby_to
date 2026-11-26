describe(`getRegistryAuthToken`, () => {
  let fetchSpy
  let getRegistryAuthToken

  beforeEach(() => {
    jest.resetModules()
    fetchSpy = jest.spyOn(global, `fetch`)
    getRegistryAuthToken = require(`../publish-package`).getRegistryAuthToken
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  const mockResponse = (body, status) =>
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": `application/json` },
        })
      )
    )

  it(`registers a user on the local registry and returns its token`, async () => {
    mockResponse({ ok: `user 'gatsby-dev' created`, token: `a-token` }, 201)

    await expect(getRegistryAuthToken()).resolves.toBe(`a-token`)

    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe(`http://localhost:4873/-/user/org.couchdb.user:gatsby-dev`)
    expect(options.method).toBe(`PUT`)
    expect(JSON.parse(options.body)).toEqual({
      name: `gatsby-dev`,
      password: `gatsby-dev`,
    })
  })

  it(`registers the user only once`, async () => {
    mockResponse({ token: `a-token` }, 201)

    await getRegistryAuthToken()
    await expect(getRegistryAuthToken()).resolves.toBe(`a-token`)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it(`rejects when the registry refuses the registration`, async () => {
    mockResponse({ error: `username is already registered` }, 409)

    await expect(getRegistryAuthToken()).rejects.toThrow(
      `Failed to register a user on the local registry: 409`
    )
  })
})
