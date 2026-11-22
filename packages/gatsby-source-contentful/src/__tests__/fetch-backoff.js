/**
 * @jest-environment node
 */
// @ts-check

import nock from "nock"
import { fetchContent } from "../fetch"
import { createPluginConfig } from "../plugin-options"

const host = `localhost`
const options = {
  spaceId: `12345`,
  accessToken: `67890`,
  host,
  contentfulClientConfig: {
    retryLimit: 2,
  },
}

const baseURI = `https://${host}`

const start = jest.fn()
const end = jest.fn()
const mockActivity = {
  start,
  end,
  tick: jest.fn(),
  done: end,
}

const reporter = {
  info: jest.fn(),
  verbose: jest.fn(),
  warn: jest.fn(),
  panic: jest.fn(e => {
    throw e
  }),
  activityTimer: jest.fn(() => mockActivity),
  createProgress: jest.fn(() => mockActivity),
}

const pluginConfig = createPluginConfig(options)

describe(`fetch-backoff`, () => {
  afterEach(() => {
    nock.cleanAll()
    reporter.verbose.mockClear()
    reporter.panic.mockClear()
    reporter.warn.mockClear()
  })

  test(`backoffs page limit when limit is reached`, async () => {
    jest.setTimeout(30000)
    const scope = nock(baseURI)
      // スペース
      .get(`/spaces/${options.spaceId}/`)
      .reply(200, { items: [] })
      // ロケール
      .get(`/spaces/${options.spaceId}/environments/master/locales`)
      .reply(200, { items: [{ code: `en`, default: true }] })
      // 1000 件で同期（多すぎる）
      .get(
        `/spaces/${options.spaceId}/environments/master/sync?initial=true&limit=1000`
      )
      .times(1)
      .reply(400, {
        sys: { type: `Error`, id: `BadRequest` },
        message: `Response size too big. Maximum allowed response size: 512000B.`,
        requestId: `12345`,
      })
      // 666 件で同期（まだ多すぎる）
      .get(
        `/spaces/${options.spaceId}/environments/master/sync?initial=true&limit=666`
      )
      .times(1)
      .reply(400, {
        sys: { type: `Error`, id: `BadRequest` },
        message: `Response size too big. Maximum allowed response size: 512000B.`,
        requestId: `12345`,
      })
      // 444 件で同期
      .get(
        `/spaces/${options.spaceId}/environments/master/sync?initial=true&limit=444`
      )
      .reply(200, { items: [] })
    await fetchContent({ pluginConfig, reporter, syncToken: null })

    expect(reporter.panic).not.toHaveBeenCalled()
    expect(reporter.warn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "The sync with Contentful failed using pageLimit 1000 as the reponse size limit of the API is exceeded.

      Retrying sync with pageLimit of 666",
        ],
        Array [
          "The sync with Contentful failed using pageLimit 666 as the reponse size limit of the API is exceeded.

      Retrying sync with pageLimit of 444",
        ],
        Array [
          "We recommend you to set your pageLimit in gatsby-config.js to 444 to avoid failed synchronizations.",
        ],
      ]
    `)
    expect(scope.isDone()).toBeTruthy()
  })

  test(`does not backoff page limit when limit is not reached`, async () => {
    jest.setTimeout(30000)
    const scope = nock(baseURI)
      // スペース
      .get(`/spaces/${options.spaceId}/`)
      .reply(200, { items: [] })
      // ロケール
      .get(`/spaces/${options.spaceId}/environments/master/locales`)
      .reply(200, { items: [{ code: `en`, default: true }] })
      // 1000 件で同期（上限を超えない）
      .get(
        `/spaces/${options.spaceId}/environments/master/sync?initial=true&limit=1000`
      )
      .reply(200, { items: [] })

    await fetchContent({ pluginConfig, reporter, syncToken: null })

    expect(reporter.panic).not.toHaveBeenCalled()
    expect(reporter.warn).not.toHaveBeenCalled()
    expect(scope.isDone()).toBeTruthy()
  })
})
