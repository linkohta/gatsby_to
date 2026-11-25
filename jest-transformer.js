const babelJest = require(`babel-jest`)

// ESM 専用パッケージ（Babel 8 など）は、Jest が CommonJS に変換してから読み込む。
// CommonJS には `import.meta` がないので、同じ意味の CommonJS の式に置き換える
function transformImportMeta({ types: t, template }) {
  const replacements = {
    url: template.expression.ast`require("url").pathToFileURL(__filename).href`,
    filename: t.identifier(`__filename`),
    dirname: t.identifier(`__dirname`),
  }

  return {
    name: `transform-import-meta`,
    visitor: {
      MemberExpression(path) {
        const { object, property, computed } = path.node

        if (
          !computed &&
          t.isMetaProperty(object) &&
          object.meta.name === `import` &&
          Object.hasOwn(replacements, property.name)
        ) {
          path.replaceWith(t.cloneNode(replacements[property.name]))
        }
      },
    },
  }
}

module.exports = babelJest.default.createTransformer({
  presets: [`babel-preset-gatsby-package`],
  plugins: [transformImportMeta],
  babelrcRoots: [
    // Keep the root as a root
    `.`,

    // Also consider monorepo packages "root" and load their .babelrc files.
    `./packages/*`,
  ],
})
