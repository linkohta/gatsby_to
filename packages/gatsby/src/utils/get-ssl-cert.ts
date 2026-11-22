import report from "gatsby-cli/lib/reporter"
import fs from "fs"
import path from "path"
import os from "os"
import { ICert } from "../commands/types"
import prompts from "prompts"

const absoluteOrDirectory = (directory: string, filePath: string): string => {
  // 絶対パスに対応する
  if (path.isAbsolute(filePath)) {
    return filePath
  }
  return path.join(directory, filePath)
}

const getWindowsEncryptionPassword = async (): Promise<string> => {
  report.info(
    [
      `A password is required to access the secure certificate authority key`,
      `used for signing certificates.`,
      ``,
      `If this is the first time this has run, then this is to set the password`,
      `for future use.  If any new certificates are signed later, you will need`,
      `to use this same password.`,
      ``,
    ].join(`\n`)
  )
  const results = await prompts({
    type: `password`,
    name: `value`,
    message: `Please enter the CA password`,
    validate: input => input.length > 0 || `You must enter a password.`,
  })
  return results.value
}

export interface IGetSslCertArgs {
  name: string
  certFile?: string
  keyFile?: string
  caFile?: string
  directory: string
}

export async function getSslCert({
  name,
  certFile,
  keyFile,
  caFile,
  directory,
}: IGetSslCertArgs): Promise<ICert | false> {
  // 証明書ファイルと鍵ファイルが、両方とも true か両方とも false であることを確認する。両方とも
  // false の場合は、デフォルトで自動の ssl になる
  if (certFile ? !keyFile : keyFile) {
    report.panic({
      id: `11521`,
      context: {},
    })
  }

  if (certFile && keyFile) {
    const keyPath = absoluteOrDirectory(directory, keyFile)
    const certPath = absoluteOrDirectory(directory, certFile)

    process.env.NODE_EXTRA_CA_CERTS = caFile
      ? absoluteOrDirectory(directory, caFile)
      : certPath
    return {
      key: fs.readFileSync(keyPath, `utf-8`),
      cert: fs.readFileSync(certPath, `utf-8`),
    }
  }

  report.info(
    `setting up automatic SSL certificate (may require elevated permissions/sudo)\n`
  )
  try {
    if ([`linux`, `darwin`].includes(os.platform()) && !process.env.HOME) {
      // これは、linux と mac で process.env.HOME が確実に設定されているようにするための、完全なハックである
      // devcert は import 時に設定のパスを作成する（そのため、ダミーの値を設定した後に devcert を import する）:
      // - https://github.com/davewasmer/devcert/blob/2b1b8d40eda251616bf74fd69f00ae8222ca1171/src/constants.ts#L15
      // - https://github.com/LinusU/node-application-config-path/blob/ae49ff6748b68b29ec76c00ce4a28ba8e9161d9b/index.js#L13
      // HOME が設定されていないと、次の致命的なエラーになる:
      // "The "path" argument must be of type s tring. Received type undefined"
      // これでもおそらく致命的なエラーになるが、少なくとも import 時には起きない
      const mkdtemp = fs.mkdtempSync(path.join(os.tmpdir(), `home-`))
      process.env.HOME = mkdtemp
    }
    const getDevCert = require(`@expo/devcert`).certificateFor
    const { caPath, key, cert } = await getDevCert(name, {
      getCaPath: true,
      skipCertutilInstall: false,
      ui: {
        getWindowsEncryptionPassword,
      },
    })
    if (caPath) {
      process.env.NODE_EXTRA_CA_CERTS = caPath
    }
    return {
      key: key.toString(),
      cert: cert.toString(),
    }
  } catch (err) {
    report.panic({
      id: `11522`,
      error: err,
      context: {
        message: err.message,
      },
    })
  }

  return false
}
