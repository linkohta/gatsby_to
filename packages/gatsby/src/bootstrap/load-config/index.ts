import reporter from "gatsby-cli/lib/reporter"
import { preferDefault } from "../prefer-default"
import { getConfigFile } from "../get-config-file"
import { internalActions } from "../../redux/actions"
import { loadThemes } from "../load-themes"
import { store } from "../../redux"
import handleFlags from "../../utils/handle-flags"
import availableFlags from "../../utils/flags"
import { IProgram } from "../../commands/types"
import { IGatsbyConfig } from "../../internal"

export async function loadConfig({
  siteDirectory,
  processFlags = false,
}: {
  siteDirectory: string
  processFlags?: boolean
  program?: IProgram
}): Promise<IGatsbyConfig> {
  // サイトの gatsby-config.js ファイルを開いてみる。
  const { configModule, configFilePath } = await getConfigFile(
    siteDirectory,
    `gatsby-config`
  )
  let config = preferDefault(configModule)

  // ルートの設定は関数として export できない。できるのはテーマの設定だけである
  if (typeof config === `function`) {
    reporter.panic({
      id: `10126`,
      context: {
        configName: `gatsby-config`,
        siteDirectory,
      },
    })
  }

  if (processFlags) {
    // フラグを設定する
    const {
      enabledConfigFlags,
      unknownFlagMessage,
      unfitFlagMessage,
      message,
    } = handleFlags(availableFlags, config?.flags ?? {})

    if (unknownFlagMessage !== ``) {
      reporter.warn(unknownFlagMessage)
    }
    if (unfitFlagMessage !== ``) {
      reporter.warn(unfitFlagMessage)
    }
    //  フラグごとに process.env を設定する
    enabledConfigFlags.forEach(flag => {
      process.env[flag.env] = `true`
    })

    // メッセージを出力する。
    if (message !== ``) {
      reporter.info(message)
    }

    process.env.GATSBY_SLICES = `true`
  }

  // テーマの gatsby-config は、関数でもオブジェクトでもよい
  if (config) {
    const plugins = await loadThemes(config, {
      configFilePath,
      rootDir: siteDirectory,
    })
    config = plugins.config
  }

  store.dispatch(internalActions.setSiteConfig(config))

  return config
}
