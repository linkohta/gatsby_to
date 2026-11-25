import { Compiler, Module } from "webpack"

/**
 * これは次の問題に対処するための完全なハックである:
 *  - https://github.com/webpack-contrib/mini-css-extract-plugin/issues/706
 *  - https://github.com/webpack-contrib/mini-css-extract-plugin/issues/708
 * 仕組みとしては、HotModuleReplacementPlugin が内部で確認している内容を調べ、
 * mini-css-extract-plugin を使うモジュールが変更された、または新しく追加されたかを
 * 確認したうえで blank.css のハッシュを変更して、このプラグインを欺いている。
 * blank.css はすべてのページで使われ、最初から存在する css モジュールなので、
 * そのハッシュを変更すれば、次のことが保証される _はず_ である:
 *  - 新しい css が import されたとき、css が再読み込みされる
 *  - （ランタイムが）まだ読み込んでいないページテンプレートが import している css が変更されたとき、css が再読み込みされる
 */
export class ForceCssHMRForEdgeCases {
  declare private name: string
  declare private originalBlankCssHash: string | undefined
  declare private blankCssKey: string | undefined
  private hackCounter = 0
  private previouslySeenCss: Set<string> = new Set<string>()

  constructor() {
    this.name = `ForceCssHMRForEdgeCases`
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(this.name, compilation => {
      compilation.hooks.fullHash.tap(this.name, () => {
        const chunkGraph = compilation.chunkGraph
        const records = compilation.records

        if (!records.chunkModuleHashes) {
          return
        }

        const seenCssInThisCompilation = new Set<string>()
        /**
         * 前回のコンパイルで使われた css の一覧から、今回のコンパイルで使われている
         * モジュールをすべて取り除くことで、今回のコンパイルで削除された css モジュールの
         * 一覧を得る。
         */
        const cssRemovedInThisCompilation = this.previouslySeenCss

        let newOrUpdatedCss = false

        for (const chunk of compilation.chunks) {
          const getModuleHash = (module: Module): string => {
            if (compilation.codeGenerationResults.has(module, chunk.runtime)) {
              return compilation.codeGenerationResults.getHash(
                module,
                chunk.runtime
              )
            } else {
              return chunkGraph.getModuleHash(module, chunk.runtime)
            }
          }

          const modules = chunkGraph.getChunkModulesIterable(chunk)

          if (modules !== undefined) {
            for (const module of modules) {
              const key = `${chunk.id}|${module.identifier()}`

              if (
                !this.originalBlankCssHash &&
                // @ts-ignore - exists on NormalModule but not Module
                module.rawRequest === `./blank.css`
              ) {
                this.blankCssKey = key
                this.originalBlankCssHash =
                  records.chunkModuleHashes[this.blankCssKey]
              }

              // @ts-ignore - exists on NormalModule but not Module
              const isUsingMiniCssExtract = module.loaders?.find(loader =>
                loader?.loader?.includes(`mini-css-extract-plugin`)
              )

              if (isUsingMiniCssExtract) {
                seenCssInThisCompilation.add(key)
                cssRemovedInThisCompilation.delete(key)

                const hash = getModuleHash(module)
                if (records.chunkModuleHashes[key] !== hash) {
                  newOrUpdatedCss = true
                }
              }
            }
          }
        }

        // css ファイルが編集された、または新しい css の import が追加された場合（`newOrUpdatedCss`）、
        // あるいは css の import が削除された場合（`cssRemovedInThisCompilation.size > 0`）は、
        // webpack の HMR に `blank.css` ファイルが変更されたと思い込ませる。
        if (
          (newOrUpdatedCss || cssRemovedInThisCompilation.size > 0) &&
          this.originalBlankCssHash &&
          this.blankCssKey
        ) {
          records.chunkModuleHashes[this.blankCssKey] =
            this.originalBlankCssHash + String(this.hackCounter++)
        }

        this.previouslySeenCss = seenCssInThisCompilation
      })
    })
  }
}
