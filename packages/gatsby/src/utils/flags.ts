import _ from "lodash"
import semver from "semver"

// この実験的機能がビルドでだけ動くか
type executingCommand = "build" | "develop" | "all"

export const satisfiesSemvers = (
  semverConstraints: Record<string, string>
): boolean => {
  // フラグのそれぞれの semver の確認を行う。
  // どれか 1 つでも false であれば、フラグは通過しない
  const result = _.toPairs(semverConstraints).every(
    ([packageName, semverConstraint]) => {
      let packageVersion: string
      try {
        packageVersion = require(`${packageName}/package.json`).version
      } catch (e) {
        return false
      }

      // 関心があるのは、semver の確認を通過しない場合である。
      return semver.satisfies(packageVersion, semverConstraint, {
        includePrerelease: true,
      })
    }
  )

  return result
}

export type fitnessEnum = true | false | "OPT_IN" | "LOCKED_IN"

export interface IFlag {
  name: string
  env: string
  description: string
  command: executingCommand
  /**
   * 有効化されたフラグを追跡するための文字列の識別子を使う。追跡を無効にする場合は false を使う（フラグが新しいデフォルトになったときに役立つ）
   */
  telemetryId: string | false
  // フラグが実験的かどうかを判断するためのヒューリスティック:
  // - ほとんどの人が遭遇し、Gatsby を通常どおり使えなくする既知の
  // バグがある
  // - その機能を試した人がごく少なく、よくある問題さえ洗い出せているか
  // 分からない。
  //
  // フラグは実験的として始めるべきだが、既知の重大なバグがすべて
  // 解決され、約 50 人以上が試したら、experimental を false に
  // 設定すべきである。
  experimental: boolean
  /**
   * true は、その機能の条件が満たされており、ユーザーがオプトインできることを意味する。
   *
   * false は、ユーザーが true に設定しても無効になることを意味する。たとえば、
   * 何かのバージョンが十分に新しくないなど、単純に動かない場合である。
   *
   * OPT_IN は、（ユーザーが明示的に無効にしない限り）gatsby がフラグを
   * 有効にすることを意味する。
   *
   * LOCKED_IN は、その機能が常に有効であることを意味する（`noCI` の条件が満たされる場合を除く）。
   * これは主に、ユーザーが設定でそのフラグを指定しているときに、フラグを一覧から削除する代わりに、
   * より意味のあるメッセージをターミナルに出すためのものである
   * （不明なフラグというメッセージを避け、「もう不要である」というメッセージを表示する）。
   */
  testFitness: (flag: IFlag) => fitnessEnum
  /**
   * この機能を使うための要件を説明する、人が読めるテキスト
   * （例: Node 14 以上が必要）
   *
   * testFitness() が `false` を返したが、gatsby-config.js でフラグが設定されている場合に、ユーザーに表示される
   */
  requires?: string
  includedFlags?: Array<string>
  umbrellaIssue?: string
  noCI?: boolean
}

const activeFlags: Array<IFlag> = [
  {
    name: `FAST_DEV`,
    env: `GATSBY_EXPERIMENTAL_FAST_DEV`,
    command: `develop`,
    telemetryId: `FastDev`,
    experimental: false,
    description: `Enable all experiments aimed at improving develop server start time & develop DX.`,
    includedFlags: [`DEV_SSR`, `PRESERVE_FILE_DOWNLOAD_CACHE`],
    testFitness: (): fitnessEnum => true,
  },
  {
    name: `DEV_SSR`,
    env: `GATSBY_EXPERIMENTAL_DEV_SSR`,
    command: `develop`,
    telemetryId: `DevSsr`,
    experimental: false,
    description: `Server Side Render (SSR) pages on full reloads during develop. Helps you detect SSR bugs and fix them without needing to do full builds.`,
    umbrellaIssue: `https://gatsby.dev/dev-ssr-feedback`,
    testFitness: (): fitnessEnum => true,
  },
  {
    name: `PRESERVE_FILE_DOWNLOAD_CACHE`,
    env: `GATSBY_EXPERIMENTAL_PRESERVE_FILE_DOWNLOAD_CACHE`,
    command: `all`,
    telemetryId: `PreserveFileDownloadCache`,
    experimental: false,
    description: `Don't delete the downloaded files cache when changing gatsby-node.js & gatsby-config.js files.`,
    umbrellaIssue: `https://gatsby.dev/cache-clearing-feedback`,
    testFitness: (): fitnessEnum => true,
  },
  {
    name: `PARALLEL_SOURCING`,
    env: `GATSBY_EXPERIMENTAL_PARALLEL_SOURCING`,
    command: `all`,
    telemetryId: `ParallelSourcing`,
    experimental: true,
    description: `Run all source plugins at the same time instead of serially. For sites with multiple source plugins, this can speedup sourcing and transforming considerably.`,
    umbrellaIssue: `https://gatsby.dev/parallel-sourcing-feedback`,
    testFitness: (): fitnessEnum => true,
  },
  {
    name: `DETECT_NODE_MUTATIONS`,
    env: `GATSBY_DETECT_NODE_MUTATIONS`,
    command: `all`,
    telemetryId: `DetectNodeMutations`,
    description: `Diagnostic mode to log any attempts to mutate node directly. Helpful when debugging missing data problems. See https://gatsby.dev/debugging-missing-data for more details.`,
    experimental: false,
    testFitness: (): fitnessEnum => true,
  },
  {
    name: `PARTIAL_HYDRATION`,
    env: `GATSBY_PARTIAL_HYDRATION`,
    command: `build`,
    telemetryId: `PartialHydration`,
    description: `Enable partial hydration to reduce Total Blocking Time and Time To Interactive `,
    umbrellaIssue: `https://gatsby.dev/partial-hydration-umbrella-issue`,
    experimental: true,
    testFitness: (): fitnessEnum => {
      const v18Constraint = {
        react: `>=18.0.0`,
      }
      const v0Constraint = {
        react: `^0.0.0`,
      }

      return (
        _CFLAGS_.GATSBY_MAJOR === `5` &&
        (satisfiesSemvers(v18Constraint) || satisfiesSemvers(v0Constraint))
      )
    },
    requires:
      Number(_CFLAGS_.GATSBY_MAJOR) < 5
        ? `Partial hydration is only available in Gatsby V5. Please upgrade Gatsby.`
        : `Partial hydration requires React 18+ to work.`,
  },
]

export default activeFlags
