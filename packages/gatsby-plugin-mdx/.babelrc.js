module.exports = {
  presets: [["babel-preset-gatsby-package", { esm: true }]],
  plugins: ["@babel/plugin-transform-modules-commonjs"],
  // babel-preset-gatsby-package は、Babel 7 のときの loose: true に相当する assumptions を
  // 指定している。このパッケージは CommonJS への変換を loose にしていなかったので、
  // モジュールの変換に関係するものだけ元に戻す
  assumptions: {
    constantReexports: false,
    enumerableModuleMeta: false,
  },
}
