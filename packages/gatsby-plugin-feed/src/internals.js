export const runQuery = (handler, query) =>
  handler(query).then(r => {
    if (r.errors) {
      throw new Error(r.errors.join(`, `))
    }

    return r.data
  })

export const defaultOptions = {
  // RSS の "generator" タグを手動で指定したい場合は上書きする。
  generator: `GatsbyJS`,

  // デフォルトのクエリを実行して、サイトの情報を集める。
  query: `
    {
      site {
        siteMetadata {
          title
          description
          siteUrl
          site_url: siteUrl
        }
      }
    }
  `,

  // フィード固有の各種オプションをマージして、RSS オブジェクトを用意する。
  setup: ({
    query: {
      site: { siteMetadata },
    },
    ...rest
  }) => {
    return {
      ...siteMetadata,
      ...rest,
    }
  },

  // デフォルトの RSS フィードを作成する。以下の形式で他のフィードも追加できる。
  feeds: [
    {
      query: `
      {
        allMarkdownRemark(
          limit: 1000,
          sort: {
            order: DESC,
            fields: [frontmatter___date]
          }
        ) {
          edges {
            node {
              frontmatter {
                title
                date
              }
              fields {
                slug
              }
              excerpt
              html
            }
          }
        }
      }
    `,

      // このクエリで生成したフィードの保存先。
      output: `rss.xml`,
    },
  ],
}
