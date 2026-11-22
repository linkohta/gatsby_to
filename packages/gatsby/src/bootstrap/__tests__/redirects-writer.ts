import { writeRedirects } from "../redirects-writer"
import * as fs from "fs-extra"
import reporter from "gatsby-cli/lib/reporter"
import { store } from "../../redux"
import { actions } from "../../redux/actions"

jest.mock(`fs-extra`, () => {
  return { writeFile: jest.fn(), readFileSync: jest.fn(() => `foo`) }
})

jest.mock(`gatsby-cli/lib/reporter`, () => {
  return {
    warn: jest.fn(),
  }
})

const writeFileMock = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>
const reporterWarnMock = reporter.warn as jest.MockedFunction<
  typeof reporter.warn
>

beforeEach(() => {
  writeFileMock.mockClear()
  reporterWarnMock.mockClear()
  store.dispatch({ type: `DELETE_CACHE` })
})

describe(`redirect-writer`, () => {
  it(`doesn't save non browser redirects`, async () => {
    store.dispatch(
      actions.createRedirect({
        fromPath: `/server/`,
        toPath: `/server/redirect/`,
      })
    )
    store.dispatch(
      actions.createRedirect({
        fromPath: `/client/`,
        toPath: `/client/redirect/`,
        redirectInBrowser: true,
      })
    )

    await writeRedirects()

    expect(writeFileMock).toBeCalledTimes(1)

    const clientSideRedirects = JSON.parse(writeFileMock.mock.calls[0][1])

    expect(clientSideRedirects).toContainEqual(
      expect.objectContaining({ fromPath: `/client/` })
    )
    expect(clientSideRedirects).not.toContainEqual(
      expect.objectContaining({ fromPath: `/server/` })
    )

    expect(reporterWarnMock).not.toBeCalled()
  })

  it(`show warning when there is both redirect and page with same path`, async () => {
    store.dispatch(
      actions.createRedirect({
        fromPath: `/server-overlap/`,
        toPath: `/server-overlap/redirect/`,
      })
    )
    store.dispatch(
      actions.createRedirect({
        fromPath: `/client-overlap`, // 末尾のスラッシュは意図的に付けていない。/client-overlap/ ページが検出されるかを確認する
        toPath: `/client-overlap/redirect/`,
        redirectInBrowser: true,
      })
    )
    store.dispatch(
      actions.createPage(
        {
          path: `/server-overlap`, // 末尾のスラッシュは意図的に付けていない。/server-overlap/ へのリダイレクトが検出されるかを確認する
          component: `/whatever/index.js`,
        },
        { id: `test`, name: `test` }
      )
    )
    store.dispatch(
      actions.createPage(
        {
          path: `/client-overlap/`,
          component: `/whatever/index.js`,
        },
        { id: `test`, name: `test` }
      )
    )

    await writeRedirects()

    expect(writeFileMock).toBeCalledTimes(1)

    const clientSideRedirects = JSON.parse(writeFileMock.mock.calls[0][1])

    expect(clientSideRedirects).toContainEqual(
      expect.objectContaining({ fromPath: `/client-overlap` })
    )

    expect(clientSideRedirects).not.toContainEqual(
      expect.objectContaining({ fromPath: `/server-overlap/` })
    )

    expect(reporterWarnMock).toBeCalledTimes(1)

    const warningMessage = reporterWarnMock.mock.calls[0][0]
    expect(warningMessage).toMatchInlineSnapshot(`
      "There are routes that match both page and redirect. Pages take precedence over redirects so the redirect will not work:
       - page: \\"/server-overlap/\\" and redirect: \\"/server-overlap/\\" -> \\"/server-overlap/redirect/\\"
       - page: \\"/client-overlap/\\" and redirect: \\"/client-overlap\\" -> \\"/client-overlap/redirect/\\""
    `)
  })
})
