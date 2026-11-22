import moment, { MomentInput, unitOfTime, LocaleSpecifier } from "moment"
import { GraphQLScalarType, Kind, GraphQLFieldConfig } from "graphql"
import { oneLine } from "common-tags"
import GatsbyCacheLmdb from "../../utils/cache-lmdb"

interface IFormatDateArgs {
  date: Date | string
  fromNow?: boolean
  formatString?: string
  difference?: unitOfTime.Diff
  locale?: LocaleSpecifier
}
interface IDateResolverOption {
  locale?: string
  formatString?: string
  fromNow?: boolean
  difference?: string
  from?: string
  fromNode?: boolean
}
type DateResolverFieldConfig = GraphQLFieldConfig<any, any, any>
type DateResolver = (
  source: any,
  args: any,
  context: any,
  info: any
) => Promise<null | string | number | Array<string | number>>

const ISO_8601_FORMAT = [
  `YYYY`,
  `YYYY-MM`,
  `YYYY-MM-DD`,
  `YYYYMMDD`,

  // ローカル時刻
  `YYYY-MM-DDTHH`,
  `YYYY-MM-DDTHH:mm`,
  `YYYY-MM-DDTHHmm`,
  `YYYY-MM-DDTHH:mm:ss`,
  `YYYY-MM-DDTHHmmss`,
  `YYYY-MM-DDTHH:mm:ss.SSS`,
  `YYYY-MM-DDTHHmmss.SSS`,
  `YYYY-MM-DDTHH:mm:ss.SSSSSS`,
  `YYYY-MM-DDTHHmmss.SSSSSS`,
  // `YYYY-MM-DDTHH:mm:ss.SSSSSSSSS`,
  // `YYYY-MM-DDTHHmmss.SSSSSSSSS`,

  // ローカル時刻（T を省略）
  `YYYY-MM-DD HH`,
  `YYYY-MM-DD HH:mm`,
  `YYYY-MM-DD HHmm`,
  `YYYY-MM-DD HH:mm:ss`,
  `YYYY-MM-DD HHmmss`,
  `YYYY-MM-DD HH:mm:ss.SSS`,
  `YYYY-MM-DD HHmmss.SSS`,
  `YYYY-MM-DD HH:mm:ss.SSSSSS`,
  `YYYY-MM-DD HHmmss.SSSSSS`,
  // `YYYY-MM-DD HH:mm:ss.SSSSSSSSS`,
  // `YYYY-MM-DD HHmmss.SSSSSSSSS`,

  // 協定世界時（UTC）
  `YYYY-MM-DDTHHZ`,
  `YYYY-MM-DDTHH:mmZ`,
  `YYYY-MM-DDTHHmmZ`,
  `YYYY-MM-DDTHH:mm:ssZ`,
  `YYYY-MM-DDTHHmmssZ`,
  `YYYY-MM-DDTHH:mm:ss.SSSZ`,
  `YYYY-MM-DDTHHmmss.SSSZ`,
  `YYYY-MM-DDTHH:mm:ss.SSSSSSZ`,
  `YYYY-MM-DDTHHmmss.SSSSSSZ`,
  // `YYYY-MM-DDTHH:mm:ss.SSSSSSSSSZ`,
  // `YYYY-MM-DDTHHmmss.SSSSSSSSSZ`,

  // 協定世界時（UTC）（T を省略）
  `YYYY-MM-DD HHZ`,
  `YYYY-MM-DD HH:mmZ`,
  `YYYY-MM-DD HHmmZ`,
  `YYYY-MM-DD HH:mm:ssZ`,
  `YYYY-MM-DD HHmmssZ`,
  `YYYY-MM-DD HH:mm:ss.SSSZ`,
  `YYYY-MM-DD HHmmss.SSSZ`,
  `YYYY-MM-DD HH:mm:ss.SSSSSSZ`,
  `YYYY-MM-DD HHmmss.SSSSSSZ`,
  // `YYYY-MM-DD HH:mm:ss.SSSSSSSSSZ`,
  // `YYYY-MM-DD HHmmss.SSSSSSSSSZ`,

  // 協定世界時（UTC）（T を省略し、Z の前に余分なスペースがある）
  `YYYY-MM-DD HH Z`,
  `YYYY-MM-DD HH:mm Z`,
  `YYYY-MM-DD HHmm Z`,
  `YYYY-MM-DD HH:mm:ss Z`,
  `YYYY-MM-DD HHmmss Z`,
  `YYYY-MM-DD HH:mm:ss.SSS Z`,
  `YYYY-MM-DD HHmmss.SSS Z`,
  `YYYY-MM-DD HH:mm:ss.SSSSSS Z`,
  `YYYY-MM-DD HHmmss.SSSSSS Z`,

  `YYYY-[W]WW`,
  `YYYY[W]WW`,
  `YYYY-[W]WW-E`,
  `YYYY[W]WWE`,
  `YYYY-DDDD`,
  `YYYYDDDD`,
]

export const GraphQLDate = new GraphQLScalarType({
  name: `Date`,
  description: oneLine`
    A date string, such as 2007-12-03, compliant with the ISO 8601 standard
    for representation of dates and times using the Gregorian calendar.`,
  serialize: String,
  parseValue: String,
  parseLiteral(ast): string | undefined {
    return ast.kind === Kind.STRING ? ast.value : undefined
  },
})

const momentFormattingTokens =
  /(\[[^[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|YYYYYY|YYYYY|YYYY|YY|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g
const momentFormattingRegexes = {
  YYYY: `\\d{4}`,
  MM: `\\d{2}`,
  DD: `\\d{2}`,
  DDDD: `\\d{4}`,
  HH: `\\d{2}`,
  mm: `\\d{2}`,
  ss: `\\d{2}`,
  SSS: `\\d{3}`,
  SSSSSS: `\\d{6}`,
  E: `\\d`,
  W: `\\d`,
  WW: `\\d{2}`,
  "[W]": `W`,
  ".": `\\.`,
  Z: `(Z|[+-]\\d\\d(?::?\\d\\d)?)`,
}
const ISO_8601_FORMAT_AS_REGEX = ISO_8601_FORMAT.map(format => {
  const matchedFormat = format.match(momentFormattingTokens)
  if (matchedFormat === null) return ``
  // ISO 文字列を momentTokens のマップ（[YYYY, MM, DD]）に変換する
  return [...matchedFormat]
    .map(token =>
      // トークン（YYYY や ss）が見つかるかを調べ、見つからなければ値をそのまま返す
      momentFormattingRegexes[token] ? momentFormattingRegexes[token] : token
    )
    .join(``)
}).join(`|`)

// フォーマットのすべての長さを計算する。文字列がそれより長いか短ければ、有効ではありえない
const ISO_8601_FORMAT_LENGTHS = [
  ...new Set(
    ISO_8601_FORMAT.reduce((acc: Array<number>, val: string) => {
      if (!val.endsWith(`Z`)) {
        return acc.concat(val.length)
      }

      // +01 と +01:00 の分の文字数を加える
      return acc.concat([val.length, val.length + 3, val.length + 5])
    }, [])
  ),
]

// 次のフォーマットを考える: YYYY-MM-DDTHH と YYYY-MM-DD HHmmss.SSSSSS Z
// この正規表現は (/^(\d{4}-\d{2}-\d{2}T\d{2}|\d{4}-\d{2}-\d{2} \d{2}\d{2}\d{2}.\d{6} Z)$) のようになる
const quickDateValidateRegex = new RegExp(`^(${ISO_8601_FORMAT_AS_REGEX})$`)

const looksLikeDateStartRegex = /^\d{4}/
// この正規表現は、最後の文字が数字または文字 Z であることを確認する
const looksLikeDateEndRegex = /(\d|Z)$/

/**
 * looksLikeADate は、本物の日付であるかを 100% 正しく確認するものではないが、少なくとも日付らしく見えるものを判定する。
 * 2010-02-30 のような値は検出できない
 * 1) 数値であるか？
 * 2) 値の長さが、いずれかのフォーマットに合っているか
 * 3) 文字列が 4 桁の数字（YYYY）で始まっているか
 * 4) 文字列が日付らしく見えるもので終わっているか
 * 5) いずれかのフォーマットに一致するかを調べる小さな正規表現
 * 6) momentjs で確認する
 *
 * @param {*} value
 * @return {boolean}
 */
export function looksLikeADate(value?: string): boolean {
  // 値が日付らしく見えないかを手早く確認する
  if (
    !value ||
    (value.length && !ISO_8601_FORMAT_LENGTHS.includes(value.length)) ||
    !looksLikeDateStartRegex.test(value) ||
    !looksLikeDateEndRegex.test(value)
  ) {
    return false
  }

  // 日付らしく見える場合は、扱えるかどうかを調べるために正規表現で日付をパースする。
  // momentjs は、何も操作をしなければ、自身も正規表現による検証をするだけである。
  if (typeof value === `string` && quickDateValidateRegex.test(value)) {
    return true
  }

  return isDate(value)
}

/**
 * @param {*} value
 * @return {boolean}
 */
export function isDate(value: MomentInput): boolean {
  const momentDate = moment.utc(value, ISO_8601_FORMAT, true)
  return typeof value !== `number` && momentDate.isValid()
}

let formatDateCache: GatsbyCacheLmdb | undefined
function getFormatDateCache(): GatsbyCacheLmdb {
  if (!formatDateCache) {
    formatDateCache = new GatsbyCacheLmdb({
      name: `format-date-cache`,
      encoding: `string`,
    }).init()
  }
  return formatDateCache
}

const formatDate = async ({
  date,
  fromNow,
  difference,
  formatString,
  locale = `en`,
}: IFormatDateArgs): Promise<string | number> => {
  const normalizedDate = JSON.parse(JSON.stringify(date))
  if (formatString) {
    const cacheKey = `${normalizedDate}-${formatString}-${locale}`
    const cachedFormat = await getFormatDateCache().get(cacheKey)
    if (cachedFormat) {
      return cachedFormat as string
    }

    const result = moment
      .utc(normalizedDate, ISO_8601_FORMAT, true)
      .locale(locale)
      .format(formatString)

    await getFormatDateCache().set(cacheKey, result)

    return result
  } else if (fromNow) {
    return moment
      .utc(normalizedDate, ISO_8601_FORMAT, true)
      .locale(locale)
      .fromNow()
  } else if (difference) {
    return moment().diff(
      moment.utc(normalizedDate, ISO_8601_FORMAT, true).locale(locale),
      difference
    )
  }
  return normalizedDate
}

export const getDateResolver = (
  options: IDateResolverOption = {},
  fieldConfig: DateResolverFieldConfig
): { args: Record<string, any>; resolve: DateResolver } => {
  const { locale, formatString, fromNow, difference } = options
  return {
    args: {
      ...fieldConfig.args,
      formatString: {
        type: `String`,
        description: oneLine`
        Format the date using Moment.js' date tokens, e.g.
        \`date(formatString: "YYYY MMMM DD")\`.
        See https://momentjs.com/docs/#/displaying/format/
        for documentation for different tokens.`,
        defaultValue: formatString,
      },
      fromNow: {
        type: `Boolean`,
        description: oneLine`
        Returns a string generated with Moment.js' \`fromNow\` function`,
        defaultValue: fromNow,
      },
      difference: {
        type: `String`,
        description: oneLine`
        Returns the difference between this date and the current time.
        Defaults to "milliseconds" but you can also pass in as the
        measurement "years", "months", "weeks", "days", "hours", "minutes",
        and "seconds".`,
        defaultValue: difference,
      },
      locale: {
        type: `String`,
        description: oneLine`
        Configures the locale Moment.js will use to format the date.`,
        defaultValue: locale,
      },
    },
    async resolve(source, args, context, info): ReturnType<DateResolver> {
      const resolver = fieldConfig.resolve || context.defaultFieldResolver
      const date = await resolver(source, args, context, {
        ...info,
        from: options.from || info.from,
        fromNode: options.from ? options.fromNode : info.fromNode,
      })

      if (date == null) {
        return null
      }

      if (Array.isArray(date)) {
        return await Promise.all(
          date.map(d => formatDate({ date: d, ...args }))
        )
      }

      return await formatDate({ date, ...args })
    },
  }
}
