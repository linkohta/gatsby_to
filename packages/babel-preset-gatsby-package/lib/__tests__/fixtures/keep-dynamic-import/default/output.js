"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
exports.__esModule = true;
exports.someFunction = someFunction;
var _interopRequireWildcard2 = _interopRequireDefault(require("@babel/runtime/helpers/interopRequireWildcard"));
async function someFunction() {
  return await Promise.resolve().then(() => (0, _interopRequireWildcard2.default)(require("path")));
}
