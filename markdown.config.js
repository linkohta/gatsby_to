const fs = require(`fs-extra`)
const path = require(`path`)
const _ = require(`lodash`)

const exclusionList = [
  `gatsby-starter-minimal`,
  `gatsby-starter-minimal-ts`,
  `gatsby-starter-plugin`,
  `gatsby-starter-theme-workspace`,
]

module.exports = {
  // README の印は markdown-magic 0.x の書式（`AUTO-GENERATED-CONTENT:START (名前)`）のまま使う。
  // markdown-magic 4 の既定は `docs` なので、ここで指定する。
  matchWord: `AUTO-GENERATED-CONTENT`,
  transforms: {
    LIST_STARTERS() {
      const base = path.join(process.cwd(), `starters`)
      const starters = fs
        .readdirSync(base)
        .filter(dir => fs.statSync(path.join(base, dir)).isDirectory())
        // Filter out excluded starters
        .filter(dir => !exclusionList.includes(dir))
        .reduce((merged, dir) => {
          merged[dir] = JSON.parse(
            fs.readFileSync(path.join(base, dir, `package.json`), `utf8`)
          )
          return merged
        }, {})

      return `
        |Name|Demo|Description|
        |:--:|----|-----------|
        ${Object.keys(starters)
          .map(name => {
            const starter = starters[name]
            return `
            |[${name}](https://github.com/gatsbyjs/gatsby-starter-${name})|[gatsby-starter-${name}-demo.netlify.app](https://gatsby-starter-${name}-demo.netlify.app/)|${starter.description}|
          `.trim()
          })
          .join(`\n`)}
      `.replace(/^[^|]+/gm, ``)
    },
    STARTER({ srcPath }) {
      const starter = path.basename(path.dirname(srcPath))

      if (exclusionList.includes(starter)) {
        return ``
      }

      const template = fs.readFileSync(
        path.join(process.cwd(), `starters`, `README-template.md`),
        `utf8`
      )
      return _.template(template)({
        name: starter,
      })
    },
  },
}
