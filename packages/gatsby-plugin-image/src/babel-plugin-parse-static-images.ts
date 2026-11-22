import type {
  PluginObj,
  template as BabelTemplate,
  types as BabelTypes,
} from "@babel/core"
import { hashOptions, evaluateImageAttributes } from "./babel-helpers"
import fs from "fs-extra"
import path from "path"
import { slash } from "gatsby-core-utils"

import { stripIndent } from "common-tags"

/**
 * StaticImage コンポーネントを見つけ、画像の props をコンポーネントに注入するプラグイン。
 * この props には画像の URL などが含まれ、ビルドのより早い段階で作成されている
 */

export default function attrs({
  types: t,
  template,
}: {
  types: typeof BabelTypes
  template: typeof BabelTemplate
}): PluginObj {
  return {
    visitor: {
      JSXOpeningElement(nodePath, state): void {
        if (
          !nodePath
            .get(`name`)
            .referencesImport(`gatsby-plugin-image`, `StaticImage`)
        ) {
          return
        }

        const unresolvedProps: Array<string> = []

        const props = evaluateImageAttributes(nodePath, prop => {
          unresolvedProps.push(prop)
        })

        let error

        if (unresolvedProps.length) {
          // TODO: プラグインのドキュメントへの短縮リンクを追加する
          error = `Could not find values for the following props at build time: ${unresolvedProps.join(
            `, `
          )}`
          console.warn(`[gatsby-plugin-image] ${error}`)
        }

        // "extractStaticImageProps" 関数と同じように、ファイル名をハッシュの計算に含める
        if (state.filename) {
          props.filename = slash(state.filename)
        }
        const hash = hashOptions(props)

        const cacheDir = (this.opts as Record<string, string>)?.cacheDir

        if (!cacheDir) {
          console.warn(
            `[gatsby-plugin-image] Couldn't find image data cache file`
          )
        }

        const filename = path.join(cacheDir, `${hash}.json`)
        let data: Record<string, unknown> | undefined

        // src prop がなければ、存在を確認しても意味がない
        if (!unresolvedProps.includes(`src`)) {
          try {
            data = fs.readJSONSync(filename)
          } catch (e) {
            // TODO: マージされたら、Gatsby の最低バージョンの情報を追加する
            const msg = stripIndent`
            Could not read image data file "${filename}". 
            This may mean that the images in "${this.filename}" were not processed.
            Please ensure that your gatsby version is at least 2.24.78.`
            error += msg
            console.warn(`[gatsby-plugin-image] ${msg}`)
          }
        }

        if (!data) {
          console.warn(
            `[gatsby-plugin-image] No data found for image "${props.src}"`
          )

          // ブラウザに表示できるよう、エラーメッセージをコンポーネントに追加する
          const newProp = t.jsxAttribute(
            t.jsxIdentifier(`__error`),

            t.jsxExpressionContainer(
              t.stringLiteral(`No data found for image "${props.src}"
              ${error || ``}`)
            )
          )
          nodePath.node.attributes.push(newProp)
          return
        }
        if (error) {
          // ブラウザに表示できるよう、エラーメッセージをコンポーネントに追加する

          const newProp = t.jsxAttribute(
            t.jsxIdentifier(`__error`),
            t.stringLiteral(error)
          )
          nodePath.node.attributes.push(newProp)
        }

        //  画像データを `require()` してコンポーネントの prop に渡す
        const makeRequire = template.expression(`require("${slash(filename)}")`)

        const newProp = t.jsxAttribute(
          t.jsxIdentifier(`__imageData`),

          t.jsxExpressionContainer(makeRequire())
        )

        nodePath.node.attributes.push(newProp)
      },
    },
  }
}
