import { getPhysicalCpuCount } from "./physical-cpu-count"

/**
 * CPU コア数を計算する
 *
 * @param ignoreEnvVar 環境変数 'GATSBY_CPU_COUNT' を無視して、要求された種類の CPU コア数を計算する
 * @return 要求された種類の CPU コア数。デフォルトは物理コア数、または 1
 */
export const cpuCoreCount = (ignoreEnvVar?: boolean): number => {
  try {
    let coreCount = getPhysicalCpuCount() || 1

    if (ignoreEnvVar) {
      // 物理 CPU 数を返す。
      // 検出できない場合のデフォルトは 1
      return coreCount
    }

    if (typeof process.env.GATSBY_CPU_COUNT !== `undefined`) {
      const coreCountArg =
        Number(process.env.GATSBY_CPU_COUNT) || process.env.GATSBY_CPU_COUNT

      switch (typeof coreCountArg) {
        case `string`:
          // coreCountArg === `physical_cores` の場合は、デフォルトの CPU 数のままにする

          // CPU 数 === 論理 CPU 数
          // 論理コアの数え上げで問題があればエラーを投げる
          if (coreCountArg === `logical_cores`) {
            coreCount = require(`os`).cpus().length

            if (typeof coreCount !== `number`) {
              throw new Error(
                `process.env.GATSBY_CPU_COUNT is set to 'logical_cores' but there was a problem finding the number of logical cores`
              )
            }
          }
          break

        case `number`:
          // CPU 数 === 渡された数
          coreCount = coreCountArg
          break

        default:
          break
      }
    }

    return coreCount
  } catch (err) {
    throw new Error(`There has been a problem counting the number of CPU cores`)
  }
}
