import traverse from "@babel/traverse"
import { NodePath } from "@babel/core"
import { JSXOpeningElement } from "@babel/types"
import { parse, ParserOptions } from "@babel/parser"
import babel from "@babel/core"
import { slash } from "gatsby-core-utils"
import { evaluateImageAttributes, hashOptions } from "../babel-helpers"
import { IStaticImageProps } from "../components/static-image.server"

const PARSER_OPTIONS: ParserOptions = {
  allowImportExportEverywhere: true,
  allowReturnOutsideFunction: true,
  allowSuperOutsideMethod: true,
  sourceType: `unambiguous`,
  plugins: [
    `jsx`,
    `flow`,
    `doExpressions`,
    `objectRestSpread`,
    [
      `decorators`,
      {
        decoratorsBeforeExport: true,
      },
    ],
    `classProperties`,
    `classPrivateProperties`,
    `classPrivateMethods`,
    `exportDefaultFrom`,
    `exportNamespaceFrom`,
    `asyncGenerators`,
    `functionBind`,
    `functionSent`,
    `dynamicImport`,
    `numericSeparator`,
    `optionalChaining`,
    `importMeta`,
    `bigInt`,
    `optionalCatchBinding`,
    `throwExpressions`,
    [
      `pipelineOperator`,
      {
        proposal: `minimal`,
      },
    ],
    `nullishCoalescingOperator`,
  ],
}

export function getBabelParserOptions(filePath: string): ParserOptions {
  // Flow と TypeScript のプラグインは同時に有効にできない
  if (/\.tsx?/.test(filePath)) {
    const { plugins } = PARSER_OPTIONS
    return {
      ...PARSER_OPTIONS,
      plugins: (plugins || []).map(plugin =>
        plugin === `flow` ? `typescript` : plugin
      ),
    }
  }
  return PARSER_OPTIONS
}

export function babelParseToAst(
  contents: string,
  filePath: string
): babel.types.File {
  return parse(contents, getBabelParserOptions(filePath))
}

/**
 * パース済みのソースを走査して、StaticImage コンポーネントを探す。
 * 見つかったものから props を取り出して返す
 */
export const extractStaticImageProps = (
  ast: babel.types.File,
  filename: string,
  onError?: (prop: string, nodePath: NodePath) => void
): Map<string, IStaticImageProps> => {
  const images: Map<string, IStaticImageProps> = new Map()

  traverse(ast, {
    JSXOpeningElement(nodePath) {
      // これは StaticImage か？
      if (
        !nodePath
          .get(`name`)
          .referencesImport(`gatsby-plugin-image`, `StaticImage`)
      ) {
        return
      }
      const image = evaluateImageAttributes(
        // NodePath の定義が @babel/core と @babel/traverse とで食い違っている
        nodePath as unknown as NodePath<JSXOpeningElement>,
        onError
      ) as unknown as IStaticImageProps
      // 複数の StaticImage で画像の props が同じで、置かれている場所だけが異なる場合、
      // ハッシュも同じになる。ハッシュが一意になるようにする必要がある。
      // ファイル名はすでに正規化されているはずだが、念のためである。
      image.filename = slash(filename)

      images.set(hashOptions(image), image)
    },
  })
  return images
}
