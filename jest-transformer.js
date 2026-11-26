const babelJest = require(`babel-jest`)

// ESM 専用パッケージ（Babel 8 など）は、Jest が CommonJS に変換してから読み込む。
// CommonJS には `import.meta` がないので、同じ意味の CommonJS の式に置き換える
function transformImportMeta({ types: t, template }) {
  const replacements = {
    // 変換元のファイルが `require` という名前の変数を自分で宣言していることがある
    // （`const require = createRequire(import.meta.url)`）。その場合に `require("url")` と書くと
    // 宣言中の変数自身を指してしまうので、`require` を使わずに組み込みモジュールを取得する
    url: template.expression
      .ast`process.getBuiltinModule("node:url").pathToFileURL(__filename).href`,
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

// Node.js は、ESM から CommonJS を default import すると `module.exports` 全体を渡す。
// Babel の既定の変換は、`__esModule` が付いた CommonJS では `exports.default` を渡すので、
// default export を持たない `@babel/types` と `@babel/parser` が `undefined` になる。
// documentation 14（ESM 専用）はこの 2 つを default import しているため、
// その組み合わせだけ Node.js と同じ動作にする
const nodeInteropImports = new Set([`@babel/types`, `@babel/parser`])
const importInterop = (specifier, requestingFilename) =>
  nodeInteropImports.has(specifier) &&
  /[\\/]node_modules[\\/]documentation[\\/]/.test(requestingFilename || ``)
    ? `node`
    : `babel`

module.exports = babelJest.default.createTransformer({
  presets: [`babel-preset-gatsby-package`],
  plugins: [
    transformImportMeta,
    [`@babel/plugin-transform-modules-commonjs`, { importInterop }],
  ],
  babelrcRoots: [
    // Keep the root as a root
    `.`,

    // Also consider monorepo packages "root" and load their .babelrc files.
    `./packages/*`,
  ],
})
