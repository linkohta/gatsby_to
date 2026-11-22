// `gatsby-confi.tsx` という名前は意図的なものである。`gatsby-config` の綴り間違いのエラーをテストするために使う

import type { GatsbyConfig } from "gatsby"

const config: GatsbyConfig = {
  siteMetadata: {
    title: `ts`,
    siteUrl: `https://www.yourdomain.tld`,
  },
  plugins: [],
}

export default config
