import { reporter } from "./reporter"

enum Flag {
  yes = `-y`, // プロンプトを省略する
  ts = `-ts`, // TypeScript を使う
}

export interface IFlags {
  yes: boolean
  ts: boolean
}

interface IArgs {
  flags: IFlags
  dirName: string
}

/**
 * 位置を考慮せずに引数を解析する。次のどちらも同じように動くべきである:
 *
 * - `npm init gatsby hello-world -y`
 * - `npm init gatsby -y hello-world`
 *
 * 位置に関係なくフラグが使えることを優先し、ダッシュで始まる名前（例: `-my-project`）の
 * ディレクトリを作ろうとするエッジケースは意図的に切り捨てている。
 */
export function parseArgs(args: Array<string>): IArgs {
  const { flags, dirName } = args.reduce(
    (sortedArgs, arg) => {
      switch (arg) {
        case Flag.yes:
          sortedArgs.flags.yes = true
          break
        case Flag.ts:
          sortedArgs.flags.ts = true
          break
        default:
          if (arg.startsWith(`-`)) {
            reporter.warn(
              `Found unknown argument "${arg}", ignoring. Known arguments are: ${Flag.yes}, ${Flag.ts}`
            )
            break
          }
          sortedArgs.dirName = arg
      }
      return sortedArgs
    },
    {
      flags: {
        yes: false,
        ts: false,
      },
      dirName: ``,
    }
  )

  return {
    flags,
    dirName,
  }
}
