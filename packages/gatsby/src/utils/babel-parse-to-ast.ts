import { parse, ParserOptions } from "@babel/parser"
import { File } from "@babel/types"

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
  // Flow のプラグインと TypeScript のプラグインは、同時には有効にできない
  if (/\.tsx?/.test(filePath)) {
    const { plugins } = PARSER_OPTIONS
    return {
      ...PARSER_OPTIONS,
      plugins: plugins!.map(plugin =>
        plugin === `flow` ? `typescript` : plugin
      ),
    }
  }
  return PARSER_OPTIONS
}

export function babelParseToAst(contents: string, filePath: string): File {
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
