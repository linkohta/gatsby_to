import { Rule } from "eslint"
import { slash } from "gatsby-core-utils"
import { GatsbyReduxStore } from "../redux"

export function isPageTemplate(
  s: GatsbyReduxStore,
  c: Rule.RuleContext
): boolean {
  const filename = c.filename
  if (!filename) {
    return false
  }

  return s.getState().components.has(slash(filename))
}

export function test(t): any {
  return Object.assign(t, {
    languageOptions: {
      sourceType: `module`,
      ecmaVersion: 9,
    },
  })
}
