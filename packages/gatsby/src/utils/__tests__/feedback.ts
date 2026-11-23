import { getConfigStore, getGatsbyVersion } from "gatsby-core-utils"
import {
  setFeedbackDisabledValue,
  userPassesFeedbackRequestHeuristic,
} from "../feedback"
jest.mock(`date-fns/getDayOfYear`, () => {
  return {
    getDayOfYear: (): number => {
      // これは、ヒューリスティック 1 が常に一致するようにするために必要である
      // Math.random が 1 を返す場合（`clearStateToAllowHeuristicsToPass` 関数でモックしている）
      const currentQuarter = Math.floor((new Date().getMonth() + 3) / 3)
      return 1 * 30 * 3 * currentQuarter
    },
  }
})
jest.mock(`gatsby-core-utils`, () => {
  return {
    ...jest.requireActual(`gatsby-core-utils`),
    getGatsbyVersion: jest.fn(() => `2.1.1`),
    isCI: (): boolean => false,
  }
})

jest.mock(
  `latest-version`,
  (): (() => Promise<string>) => (): Promise<string> => Promise.resolve(`2.1.1`)
)

const dateFromSixMonthsAgo = new Date()
dateFromSixMonthsAgo.setMonth(dateFromSixMonthsAgo.getMonth() - 6)
const mathRandom = Math.random

// この関数は、ヒューリスティックの確認がすべて通るように、すべての状態を
// リセットする。個々のテストが、そのテストの中で行う状態の操作だけに
// よって反応していることを保証するために
// 使う。
const clearStateToAllowHeuristicsToPass = (): void => {
  // ヒューリスティック 1
  Math.random = jest.fn(() => 1)
  // ヒューリスティック 2
  setFeedbackDisabledValue(false)
  // ヒューリスティック 3
  delete process.env.GATSBY_FEEDBACK_DISABLED
  // ヒューリスティック 4
  getConfigStore().set(`feedback.lastRequestDate`, dateFromSixMonthsAgo)
  getConfigStore().set(`feedback.sevenDayFeedbackDate`, dateFromSixMonthsAgo)
  // ヒューリスティック 5
  ;(getGatsbyVersion as jest.Mock).mockReturnValue(`2.1.1`)
}

describe(`feedback`, () => {
  describe(`userPassesFeedbackRequestHeuristic returns false when`, () => {
    beforeEach(clearStateToAllowHeuristicsToPass)

    afterEach(() => {
      Math.random = mathRandom
    })

    it(`Heuristic 1: The random number generator hits today`, async () => {
      // テストで操作する前に、デフォルトの状態で通ることを確認する
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)

      // 別の日付を返すように、ランダムな値を変更する
      ;(Math.random as jest.Mock).mockReturnValue(0.5)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(false)

      // テストが安定するように、設定を解除する
      ;(Math.random as jest.Mock).mockReturnValue(1)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)
    })

    it(`Heuristic 2: the gatsby disabled key is set to false`, async () => {
      // テストで操作する前に、デフォルトの状態で通ることを確認する
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)

      setFeedbackDisabledValue(true)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(false)

      // テストが安定するように、設定を解除する
      setFeedbackDisabledValue(false)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)
    })

    it("Heuristic 3: the process.env.GATSBY_FEEDBACK_DISABLED argument is set to `1`", async () => {
      // テストで操作する前に、デフォルトの状態で通ることを確認する
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)

      process.env.GATSBY_FEEDBACK_DISABLED = `1`
      expect(await userPassesFeedbackRequestHeuristic()).toBe(false)

      // テストが安定するように、設定を解除する
      process.env.GATSBY_FEEDBACK_DISABLED = `0`
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)
    })

    it(`Heuristic 4: It has been more than 3 months since the last feedback request`, async () => {
      // テストで操作する前に、デフォルトの状態で通ることを確認する
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)

      // 最後に確認を表示した日付を今日に設定する
      getConfigStore().set(`feedback.lastRequestDate`, Date.now())
      expect(await userPassesFeedbackRequestHeuristic()).toBe(false)

      // テストが安定するように、設定を解除する
      getConfigStore().set(`feedback.lastRequestDate`, dateFromSixMonthsAgo)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)
    })

    it(`Heuristic 5: The installed Gatsby is on the latest major + minor version`, async () => {
      // テストで操作する前に、デフォルトの状態で通ることを確認する
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)

      // false を強制するために、インストールされているバージョンを 1 つ前のマイナーバージョンとしてモックする
      ;(getGatsbyVersion as jest.Mock).mockReturnValue(`2.0.0`)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(false)

      // テストが安定するように、設定を解除する
      ;(getGatsbyVersion as jest.Mock).mockReturnValue(`2.1.1`)
      expect(await userPassesFeedbackRequestHeuristic()).toBe(true)
    })
  })
})
