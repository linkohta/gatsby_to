// @ts-check

/**
 * 未インストールの場合に自動でインストールするアダプターの一覧。
 * test 関数が `true` を返した最初の項目が使われる。
 *
 * アダプターの作者で、この一覧に追加したい場合は PR を送ってほしい。
 * アダプターを作りたい場合は次を参照: http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/creating-an-adapter/
 *
 * @type {Array<import("./src/utils/adapter/types").IAdapterManifestEntry>}
 * @see http://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/zero-configuration-deployments/
 */
const adaptersManifest = [
    {
    name: `Netlify`,
    module: `gatsby-adapter-netlify`,
    test: () => !!process.env.NETLIFY || !!process.env.NETLIFY_LOCAL,
    versions: [
      {
        gatsbyVersion: `^5.12.10`,
        moduleVersion: `^1.2.1`,
      },
      {
        gatsbyVersion: `>=5.0.0 <5.12.10`,
        moduleVersion: `>=1.0.0 <=1.0.3`,
      }
    ],
  }
]

module.exports = adaptersManifest
