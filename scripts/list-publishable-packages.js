#!/usr/bin/env node

// Prints the publishable (non-private) monorepo packages as a JSON array of names.
//
// Used to exempt locally published (gatsby-dev-cli / verdaccio) versions from
// Yarn 4's minimum release age gate, which otherwise quarantines them:
//
//   yarn config set --json npmPreapprovedPackages \
//     "$(node /path/to/gatsby/scripts/list-publishable-packages.js)"

const path = require(`path`)
const { getPublicPackages } = require(`./utils/workspace-packages`)

const rootPath = path.join(__dirname, `..`)

try {
  // private packages are never published
  const names = getPublicPackages(rootPath).map(pkg => pkg.name)

  console.log(JSON.stringify(names.sort()))
} catch (err) {
  console.error(err)
  process.exit(1)
}
