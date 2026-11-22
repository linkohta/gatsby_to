import {
  setFeedbackDisabledValue,
  showFeedbackRequest,
} from "../utils/feedback"
import { IProgram } from "./types"

// コマンドライン引数をこのオブジェクトに展開しているためである。
// `cliArgs` のようなキーの中に入れるのが、よいリファクタリングになるだろう
interface IFeedbackProgram extends IProgram {
  disable?: boolean
  enable?: boolean
}

module.exports = async function feedback(
  program: IFeedbackProgram
): Promise<void> {
  if (program.disable) {
    program.report.info(`Disabling gatsby feedback requests`)
    setFeedbackDisabledValue(true)
    return
  }

  if (program.enable) {
    program.report.info(`Enabling gatsby feedback requests`)
    setFeedbackDisabledValue(false)
    return
  }

  showFeedbackRequest()
}
