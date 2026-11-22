import { LoaderContext } from "webpack"

const Template = require(`webpack/lib/Template`)

/**
 * クライアントコンポーネントへの import をまとめた仮想ファイルを作るローダー
 */
module.exports = function virtual(
  this: LoaderContext<{
    modules: string
  }>
): string {
  const { modules } = this.getOptions()

  const requests = modules.split(`,`)

  const code = requests
    .filter(Boolean)
    // サーバー側では css ファイルを除外する
    .map(request => {
      const chunkName = Template.toPath(request)

      return `import(/* webpackChunkName: "${chunkName}" */ ${JSON.stringify(
        request
      )})`
    })
    .join(`;\n`)

  return code
}
