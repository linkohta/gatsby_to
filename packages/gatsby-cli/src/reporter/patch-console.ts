/*
 * このモジュールは、console を reporter 経由にするパッチを当て、それらのログを
 * 追跡できるようにするために使う
 */
import util from "util"
import { reporter as gatsbyReporter } from "./reporter"

export function patchConsole(reporter: typeof gatsbyReporter): void {
  console.log = (...args: Array<any>): void => {
    const [format, ...rest] = args
    reporter.log(util.format(format === undefined ? `` : format, ...rest))
  }
  console.warn = (...args: Array<any>): void => {
    const [format, ...rest] = args
    reporter.warn(util.format(format === undefined ? `` : format, ...rest))
  }
  console.info = (...args: Array<any>): void => {
    const [format, ...rest] = args
    reporter.info(util.format(format === undefined ? `` : format, ...rest))
  }
  console.error = (format: any, ...args: Array<any>): void => {
    reporter.error(util.format(format === undefined ? `` : format, ...args))
  }
}
