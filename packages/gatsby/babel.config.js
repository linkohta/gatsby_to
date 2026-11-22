// .babelrc ではなく babel.config.js にしておくことで、
// `internal-plugins` 内のパッケージを他のソースと一緒にコンパイルできる。
// 参考: https://github.com/babel/babel/pull/7358
module.exports = {
  sourceMaps: true,
  presets: [["babel-preset-gatsby-package", {
    keepDynamicImports: [
      `./src/utils/feedback.ts`,

      // これらのファイルは gatsby-config、gatsby-node、subPlugins を動的 import で読み込むため、ESM が動作する
      `./src/bootstrap/get-config-file.ts`,
      `./src/bootstrap/resolve-module-exports.ts`,
      `./src/bootstrap/load-plugins/validate.ts`,
      `./src/utils/adapter/init.ts`,
      `./src/utils/import-gatsby-plugin.ts`,
    ]
  }]],
}
