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
  // Babel 8 のパーサーは、仕様に入った構文（クラスフィールド、オプショナルチェーンなど）を
  // 常に解釈するので、ここにはまだ提案段階の構文と、JSX、Flow だけを並べている
  plugins: [
    `jsx`,
    `flow`,
    `doExpressions`,
    `decorators`,
    `exportDefaultFrom`,
    `functionBind`,
    `functionSent`,
    `throwExpressions`,
    [
      `pipelineOperator`,
      {
        // Babel 8 では minimal の提案がなくなった。minimal で書けた式をそのまま
        // 解釈できる fsharp を指定する
        proposal: `fsharp`,
      },
    ],
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
  const options = getBabelParserOptions(filePath)
  try {
    return parse(contents, options)
  } catch (jsxError) {
    // Babel 8 のパーサーは、JSX が有効だと `<T>(value: T) => value` のような型引数付きの
    // アロー関数を解釈できない（Babel 7 は解釈できた）。`.ts` では、JSX を無効にして解釈し直す。
    // 初めから JSX を無効にしないのは、JSX を含む `.ts` もこれまで解釈できていたからである
    if (!/\.[cm]?ts$/.test(filePath)) {
      throw jsxError
    }
    return parse(contents, {
      ...options,
      plugins: options.plugins?.filter(plugin => plugin !== `jsx`),
    })
  }
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
