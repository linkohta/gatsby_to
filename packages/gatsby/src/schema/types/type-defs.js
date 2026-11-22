const { parse, Kind: GraphQLASTNodeKind } = require(`graphql`)
import { isGatsbyType } from "./type-builders"
const { inferExtensionName, dontInferExtensionName } = require(`../extensions`)
const report = require(`gatsby-cli/lib/reporter`)

const isASTDocument = typeOrTypeDef =>
  typeof typeOrTypeDef === `object` &&
  typeOrTypeDef.kind &&
  GraphQLASTNodeKind.DOCUMENT === typeOrTypeDef.kind

/**
 * SDL の文字列で表された型定義をパースして、AST の Document にする。
 * （SDL 以外の）他の形式の型定義は、そのまま返す
 */
const parseTypeDef = typeOrTypeDef => {
  if (typeof typeOrTypeDef === `string`) {
    try {
      return parse(typeOrTypeDef)
    } catch (error) {
      reportParsingError(error)
    }
  }
  return typeOrTypeDef
}

const reportParsingError = error => {
  const { message, source, locations } = error

  if (source && locations && locations.length) {
    const { codeFrameColumns } = require(`@babel/code-frame`)

    const frame = codeFrameColumns(
      source.body,
      { start: locations[0] },
      { linesAbove: 5, linesBelow: 5 }
    )
    report.panic(
      `Encountered an error parsing the provided GraphQL type definitions:\n` +
        message +
        `\n\n` +
        frame +
        `\n`
    )
  } else {
    throw error
  }
}

/**
 * 型定義を受け取り、推論の処理をスキップすべき型の名前を集める
 */
const typesWithoutInference = (typeNames = [], typeOrTypeDef) => {
  if (typeof typeOrTypeDef === `string`) {
    typeOrTypeDef = parseTypeDef(typeOrTypeDef)
  }
  if (isASTDocument(typeOrTypeDef)) {
    typeOrTypeDef.definitions.forEach(def => {
      if (!def.directives) return

      def.directives.forEach(directive => {
        if (directive.name.value === dontInferExtensionName && def.name.value) {
          typeNames.push(def.name.value)
        }
      })
    })
    return typeNames
  }
  if (isGatsbyType(typeOrTypeDef) && typeOrTypeDef.config) {
    const { extensions = {}, name } = typeOrTypeDef.config
    if (
      name &&
      (extensions[dontInferExtensionName] ||
        extensions[inferExtensionName] === false)
    ) {
      typeNames.push(name)
    }
  }
  return typeNames
}

module.exports = {
  parseTypeDef,
  reportParsingError,
  typesWithoutInference,
  isASTDocument,
}
