import { FormInput } from "./form"
import { TextInput } from "./text"
import { SelectInput, MultiSelectInput } from "./select"

/**
 * カスタムフィールドを追加する Enquirer プラグイン
 *
 * @param enquirer {import("enquirer")}
 * @returns {import("enquirer")}
 */
export const plugin = enquirer => {
  enquirer.register(`textinput`, TextInput)
  enquirer.register(`selectinput`, SelectInput)
  enquirer.register(`multiselectinput`, MultiSelectInput)
  enquirer.register(`forminput`, FormInput)
  return enquirer
}
