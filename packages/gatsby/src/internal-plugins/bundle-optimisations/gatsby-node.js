const path = require(`path`)

exports.onCreateBabelConfig = ({ actions }) => {
  // import { get }from 'lodash' を import get from 'lodash/get'; に書き換える
  actions.setBabelPlugin({
    name: `@sigmacomputing/babel-plugin-lodash`,
  })
}

exports.onCreateWebpackConfig = function onCreateWebpackConfig({
  stage,
  actions,
}) {
  const objectAssignStub = path.join(__dirname, `polyfills/object-assign.js`)
  const noOp = path.join(__dirname, `polyfills/no-op.js`)
  const fetchStub = path.join(__dirname, `polyfills/fetch.js`)
  const whatwgFetchStub = path.join(__dirname, `polyfills/whatwg-fetch.js`)

  const alias = {
    // これらのファイルにはすでにポリフィルが適用されているので、何もしないものを返すべきである
    // スタブにするパッケージ: object.assign と object-assign
    "object.assign": objectAssignStub,
    "object-assign$": objectAssignStub,
    "@babel/runtime/helpers/extends.js$": objectAssignStub,
    // スタブにするパッケージ: fetch
    unfetch$: fetchStub,
    "unfetch/polyfill$": noOp,
    "isomorphic-unfetch$": fetchStub,
    "isomorphic-fetch$": fetchStub,
    "whatwg-fetch$": whatwgFetchStub,
  }

  if (stage === `build-javascript` || stage === `develop`) {
    alias[`url-polyfill$`] = noOp
  }

  actions.setWebpackConfig({
    resolve: {
      alias,
    },
  })
}
