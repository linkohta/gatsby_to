import joi from "joi"
import { PluginOptionsSchemaJoi } from "./utils/plugin-options-schema-joi-type"

export * from "./utils/plugin-options-schema-joi-type"
export const Joi: PluginOptionsSchemaJoi = joi.extend({
  // これは Joi に、_すべての_ 型を .dotenv() で拡張するよう指示する。次を参照
  // https://github.com/sideway/joi/commit/03adf22eb1f06c47d1583617093edee3a96b3873
  // @ts-ignore Joi types weren't updated with that commit, PR: https://github.com/sideway/joi/pull/2477
  type: /^s/,
  rules: {
    // NOTE(@mxstbr): この API が必要かどうかを決めるまで無効にしている。
    // dotenv: {
    //   args: [`name`],
    //   validate(value, helpers, args): void {
    //     if (!args.name) {
    //       return helpers.error(
    //         `any.dotenv requires the environment variable name`
    //       )
    //     }
    //     return value
    //   },
    //   method(name): Schema {
    //     return this.$_addRule({ name: `dotenv`, args: { name } })
    //   },
    // },
  },
})
