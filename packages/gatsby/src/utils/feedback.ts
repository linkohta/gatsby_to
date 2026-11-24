import report from "gatsby-cli/lib/reporter"
import { getConfigStore, getGatsbyVersion, isCI } from "gatsby-core-utils"
import { getDayOfYear } from "date-fns/getDayOfYear"

const feedbackKey = `feedback.disabled`
const lastDateKey = `feedback.lastRequestDate`
const firstDateKey = `feedback.firstCheckDate`
const sevenDayKey = `feedback.sevenDayFeedbackDate`

// この関数は、`gatsby feedback --disable` と `gatsby feedback --enable` から
// 使われることを想定している。このキーは、ユーザーにフィードバックを
// 依頼してよいかを判定するために使う
export function setFeedbackDisabledValue(enabled: boolean): void {
  getConfigStore().set(feedbackKey, enabled)
}

// フィードバックの依頼をユーザーに表示する
export function showFeedbackRequest(): void {
  getConfigStore().set(lastDateKey, Date.now())
  report.log(
    `\n\nHello! Will you help Gatsby improve by taking a four question survey?\nIt takes less than five minutes and your ideas and feedback will be very helpful.`
  )
  report.log(`\nGive us your feedback here: https://gatsby.dev/feedback\n\n`)
}

export function showSevenDayFeedbackRequest(): void {
  getConfigStore().set(sevenDayKey, Date.now())
  report.log(
    `\n\nHi there! Will you tell us about how you're learning Gatsby? \nIt takes less than 5 minutes and your feedback will help us make installing and using Gatsby so much better.`
  )
  report.log(
    `\nGive us your feedback here: https://gatsby.dev/feedback-survey\n\n`
  )
}

const randomChanceToBeTrue = (): boolean => {
  // これは、依頼の量を四半期全体に分散させる。
  // 四半期の最初の日から最後の日までの範囲で、
  // randomNumber を取得している
  const currentQuarter = Math.floor((new Date().getMonth() + 3) / 3)
  const randomNumber = Math.floor(
    Math.random() *
      // 四半期の日数（おおよそ）
      (30 * 3)
  )
  const randomNumberWithinQuarter = randomNumber + 30 * 3 * (currentQuarter - 1)

  return randomNumberWithinQuarter === getDayOfYear(new Date())
}

// フィードバックの依頼は、ユーザーが次の確認をすべて通過した場合にだけ表示する:
// 1. Math.random() の確認を通過する。これは、すべての依頼を 1 日で送ってしまわないための、最小限の実装である。
// 2. Gatsby が CI で実行されていない
// 3. フィードバックを無効にする環境変数が設定されていない
// 4. フィードバックの仕組みを無効にしていない
// 5. 前回のフィードバックの依頼から少なくとも 3 か月が経過している
// 6. Gatsby の最新バージョンを使っている
export async function userPassesFeedbackRequestHeuristic(): Promise<boolean> {
  // ヒューリスティック 1
  // 当初は、当たる機会が 1 回だけになるように書いていた。
  // その確率を 5 倍に上げたかったので、ユーザーに通過の機会を 5 回与える
  // この方法は、粗い、一時的な手段である。
  const randomlyPassingHeuristic =
    randomChanceToBeTrue() ||
    randomChanceToBeTrue() ||
    randomChanceToBeTrue() ||
    randomChanceToBeTrue() ||
    randomChanceToBeTrue()

  if (!randomlyPassingHeuristic) {
    return false
  }

  if (isFeedbackDisabled()) {
    return false
  }

  // ヒューリスティック 5
  const lastDateValue = getConfigStore().get<number>(lastDateKey)
  // 5.a ユーザーがフィードバックの依頼を一度も受け取っていない場合、これは undefined になる
  //     これは事実上の通過である。最後に依頼を受け取ってから ~無限~ の時間が
  //     経過していることになるためである。
  if (lastDateValue) {
    const lastDate = new Date(lastDateValue)
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    if (lastDate > threeMonthsAgo) {
      return false
    }
  }

  // 5.b
  // 7 日後のフィードバックのアンケートの直後に、このアンケートを出したくはない
  const sevenDayFeedback = getConfigStore().get<number>(sevenDayKey)
  if (sevenDayFeedback) {
    const sevenDayDate = new Date(sevenDayFeedback)
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    if (sevenDayDate > threeMonthsAgo) {
      return false
    }
  }

  // ヒューリスティック 6
  const versionPoints = getGatsbyVersion().split(`.`)
  let latestVersionPoints: Array<string> = []
  try {
    const { default: latestVersion } = await import(`latest-version`)
    latestVersionPoints = (await latestVersion(`gatsby`)).split(`.`)
  } catch (e) {
    // 何もしない。
    // リクエストが失敗した場合は、フィードバックの依頼を表示しないだけにすべきである。
    // これは理論上は頻繁に起こりうるので、しつこくしたくないためである。
    // この場合、`versionsMatchOnMajorAndMinor` === false であることが保証される
  }

  // バージョンは非常に頻繁に公開している。そのため、ユーザーが最新のパッチを
  // 使っていると考えるのは現実的ではないかもしれない。そこで、メジャーバージョンと
  // マイナーバージョンだけを比較している。
  const versionsMatchOnMajorAndMinor =
    versionPoints[0] === latestVersionPoints[0] &&
    versionPoints[1] === latestVersionPoints[1]

  if (versionsMatchOnMajorAndMinor === false) {
    return false
  }

  // 上のすべてを通過した場合は、ユーザーにフィードバックを
  // 依頼できる
  return true
}

function isFeedbackDisabled(): boolean {
  // この順序にしている理由: CI の確認を先に行うことで、次のような問題が直る
  // https://github.com/gatsbyjs/gatsby/issues/30647
  // TODO: あわせて、getConfigStore がエラーにならないようにする

  // ヒューリスティック 2
  if (isCI()) {
    return true
  }

  // ヒューリスティック 3
  if (process.env.GATSBY_FEEDBACK_DISABLED === `1`) {
    return true
  }

  // ヒューリスティック 4
  if (getConfigStore().get(feedbackKey) === true) {
    return true
  }

  return false
}

export async function userGetsSevenDayFeedback(): Promise<boolean> {
  if (isFeedbackDisabled()) return false

  if (getConfigStore().get(sevenDayKey)) return false

  const firstDateValue = getConfigStore().get<number>(firstDateKey)

  if (!firstDateValue) {
    getConfigStore().set(firstDateKey, Date.now()) // 初めてこれを設定する
    return false
  } else {
    const lastDate = new Date(firstDateValue)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    if (lastDate > sevenDaysAgo) {
      return false
    }
  }
  return true
}
