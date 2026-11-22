const { supportedExtensions } = require(`./supported-extensions`)

module.exports = ({ createResolvers, reporter }, pluginOptions = {}) => {
  const { checkSupportedExtensions = true } = pluginOptions

  const resolvers = {
    File: {
      childImageSharp: {
        resolve: (parent, args, context, info) => {
          // TODO: 将来、GraphQL からのコンポーネントが可能になったら、対応している画像フォーマットと対応していない画像フォーマットの両方を扱えるようにする
          if (
            !supportedExtensions[parent.extension] &&
            checkSupportedExtensions
          ) {
            reporter.warn(
              `You can't use childImageSharp together with ${parent.name}.${parent.extension} — use publicURL instead. The childImageSharp portion of the query in this file will return null:\n${context.componentPath}`
            )
          }
          return info.originalResolver(parent, args, context, info)
        },
      },
    },
  }

  createResolvers(resolvers)
}
