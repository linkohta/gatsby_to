const path = require("path")

module.exports = {
  sourceType: "module",
  plugins: [
    path.resolve(__dirname, "../../../babel-transform-static-import-specifier.js"),
  ],
  babelrc: false,
  configFile: false,
}
