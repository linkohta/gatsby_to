const path = require(`path`)
const os = require(`os`)

const verdaccioConfig = {
  storage: path.join(os.tmpdir(), `verdaccio`, `storage`),
  port: 4873, // デフォルト
  max_body_size: `1000mb`,
  web: {
    enable: true,
    title: `gatsby-dev`,
  },
  self_path: `./`,
  // 公開に使うユーザーの登録先。指定しないと、実行したディレクトリに `htpasswd` が作られる
  auth: {
    htpasswd: {
      file: path.join(os.tmpdir(), `verdaccio`, `htpasswd`),
    },
  },
  log: { type: `stdout`, format: `pretty-timestamped`, level: `warn` },
  packages: {
    "**": {
      access: `$all`,
      publish: `$all`,
      proxy: `npmjs`,
    },
  },
  uplinks: {
    npmjs: {
      url: `https://registry.npmjs.org/`,
      // デフォルトの max_fails は 2 だが、不安定なネットワークではインストールの失敗が多発する
      max_fails: 10,
    },
  },
}

exports.verdaccioConfig = verdaccioConfig

const registryUrl = `http://localhost:${verdaccioConfig.port}`

exports.registryUrl = registryUrl
