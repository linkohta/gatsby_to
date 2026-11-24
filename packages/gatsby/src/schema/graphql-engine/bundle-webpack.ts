/* eslint-disable @typescript-eslint/naming-convention */

import * as path from "path"
import * as fs from "fs-extra"
import { execa, Options as ExecaOptions } from "execa"
import webpack, { Module, NormalModule, Compilation } from "webpack"
import ConcatenatedModule from "webpack/lib/optimize/ConcatenatedModule"
import { dependencies } from "gatsby/package.json"
import { printQueryEnginePlugins } from "./print-plugins"
import mod from "module"
import { WebpackLoggingPlugin } from "../../utils/webpack/plugins/webpack-logging"
import { getAssetMeta } from "@vercel/webpack-asset-relocator-loader"
import reporter from "gatsby-cli/lib/reporter"
import { schemaCustomizationAPIs } from "./print-plugins"
import type { GatsbyNodeAPI } from "../../redux/types"
import * as nodeApis from "../../utils/api-node-docs"
import { store } from "../../redux"
import { PackageJson } from "../../.."
import { slash } from "gatsby-core-utils/path"
import { isEqual } from "lodash"
import {
  IPlatformAndArch,
  getCurrentPlatformAndTarget,
  getFunctionsTargetPlatformAndTarget,
} from "../../utils/engines-helpers"

type Reporter = typeof reporter

const extensions = [`.mjs`, `.js`, `.json`, `.node`, `.ts`, `.tsx`]

const outputDir = path.posix.join(
  slash(process.cwd()),
  `.cache`,
  `query-engine`
)
const cacheLocation = path.posix.join(
  slash(process.cwd()),
  `.cache`,
  `webpack`,
  `query-engine`
)

function getApisToRemoveForQueryEngine(): Array<GatsbyNodeAPI> {
  const apisToKeep = new Set(schemaCustomizationAPIs)
  apisToKeep.add(`onPluginInit`)

  const apisToRemove = (Object.keys(nodeApis) as Array<GatsbyNodeAPI>).filter(
    api => !apisToKeep.has(api)
  )
  return apisToRemove
}

const getInternalPackagesCacheDir = (
  functionsTarget: IPlatformAndArch
): string =>
  path.posix.join(
    slash(process.cwd()),
    `.cache`,
    `internal-packages`,
    `${functionsTarget.platform}-${functionsTarget.arch}`
  )

// 内部で使うパッケージをインストールするためのディレクトリと JS モジュールを作成する
const createInternalPackagesCacheDir = async (
  functionsTarget: IPlatformAndArch
): Promise<void> => {
  const cacheDir = getInternalPackagesCacheDir(functionsTarget)
  await fs.ensureDir(cacheDir)

  const packageJsonPath = path.join(cacheDir, `package.json`)

  if (!fs.existsSync(packageJsonPath)) {
    await fs.emptyDir(cacheDir)

    await fs.outputJson(packageJsonPath, {
      name: `gatsby-internal-packages`,
      description: `This directory contains internal packages installed by Gatsby used to comply with the current platform requirements`,
      version: `1.0.0`,
      private: true,
      author: `Gatsby`,
      license: `MIT`,
      functionsTarget,
    })
  }
}

function getLMDBBinaryFromSiteLocation(
  lmdbPackageName: string,
  version: string,
  functionsTarget: IPlatformAndArch
): string | undefined {
  // lmdb の package.json を読み、その optional dependencies を調べて、現在のプラットフォームとアーキテクチャに対応するバイナリを持つビルド済みの lmdb モジュールがあるかを検証する
  let packageJson: PackageJson
  try {
    const modulePath = path
      .dirname(slash(require.resolve(`lmdb`)))
      .replace(`/dist`, ``)
    const packageJsonPath = path.join(modulePath, `package.json`)
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, `utf-8`))
  } catch (e) {
    // lmdb の package.json の読み込みに失敗するなら、もっと大きな問題があるので、インストールをスキップするだけにする
    return undefined
  }
  // 現在のアーキテクチャとプラットフォーム向けのビルド済みの lmdb パッケージが optional dep に挙がっていなければ、インストールを試みても意味がない
  const { optionalDependencies = {} } = packageJson
  if (!Object.keys(optionalDependencies).find(p => p === lmdbPackageName)) {
    throw new Error(
      `Target platform/arch for functions execution (${functionsTarget.platform}/${functionsTarget.arch}) is not supported.`
    )
  }
  return getPackageLocationFromRequireContext(
    slash(require.resolve(`lmdb`)),
    lmdbPackageName,
    version
  )
}

function getPackageLocationFromRequireContext(
  location: string,
  packageName: string,
  packageVersion?: string
): string | undefined {
  try {
    const requireId = `${packageName}/package.json`
    const locationRequire = mod.createRequire(location)
    const packageJsonLocation = slash(locationRequire.resolve(requireId))

    if (packageVersion) {
      // delete locationRequire.cache[requireId]
      const { version } = JSON.parse(
        fs.readFileSync(packageJsonLocation, `utf-8`)
      )
      if (packageVersion !== version) {
        return undefined
      }
    }

    return path.dirname(packageJsonLocation)
  } catch (e) {
    return undefined
  }
}

interface ILMDBBinaryPackageStatusBase {
  packageName: string
  needToInstall: boolean
  packageVersion: string
}

interface ILMDBBinaryPackageStatusInstalled extends ILMDBBinaryPackageStatusBase {
  needToInstall: false
  packageLocation: string
}

interface ILMDBBinaryPackageStatusNeedAlternative extends ILMDBBinaryPackageStatusBase {
  needToInstall: true
}

type IBinaryPackageStatus =
  ILMDBBinaryPackageStatusInstalled | ILMDBBinaryPackageStatusNeedAlternative

function checkIfInstalledInInternalPackagesCache(
  packageStatus: IBinaryPackageStatus,
  functionsTarget: IPlatformAndArch
): IBinaryPackageStatus {
  const cacheDir = getInternalPackagesCacheDir(functionsTarget)

  const packageLocationFromInternalPackageCache =
    getPackageLocationFromRequireContext(
      path.posix.join(cacheDir, `:internal:`),
      packageStatus.packageName,
      packageStatus.packageVersion
    )

  if (
    packageLocationFromInternalPackageCache &&
    !path.posix
      .relative(cacheDir, packageLocationFromInternalPackageCache)
      .startsWith(`..`)
  ) {
    return {
      ...packageStatus,
      needToInstall: false,
      packageLocation: packageLocationFromInternalPackageCache,
    }
  }

  return {
    ...packageStatus,
    needToInstall: true,
  }
}

// 現在のインストールがビルド済みのバイナリを使っていないことを検出した場合は、
// lmdb のネイティブモジュールを内部キャッシュの下にインストールする
function checkIfNeedToInstallMissingLmdb(
  functionsTarget: IPlatformAndArch
): IBinaryPackageStatus {
  // 対象のプラットフォーム向けのビルド済みバイナリを持つ lmdb モジュール
  const lmdbPackageName = `@lmdb/lmdb-${functionsTarget.platform}-${functionsTarget.arch}`

  const lmdbBinaryFromSiteLocation = getLMDBBinaryFromSiteLocation(
    lmdbPackageName,
    dependencies.lmdb,
    functionsTarget
  )

  const sharedPackageStatus: ILMDBBinaryPackageStatusNeedAlternative = {
    needToInstall: true,
    packageName: lmdbPackageName,
    packageVersion: dependencies.lmdb,
  }

  if (lmdbBinaryFromSiteLocation) {
    return {
      ...sharedPackageStatus,
      needToInstall: false,
      packageLocation: lmdbBinaryFromSiteLocation,
    }
  }

  return checkIfInstalledInInternalPackagesCache(
    sharedPackageStatus,
    functionsTarget
  )
}

function checkIfNeedToInstallMissingSharp(
  functionsTarget: IPlatformAndArch,
  currentTarget: IPlatformAndArch
): IBinaryPackageStatus | undefined {
  try {
    // sharp が解決できるかを確認する
    const sharp: typeof import("sharp") = require(`sharp`)

    if (isEqual(functionsTarget, currentTarget)) {
      // 現在のプラットフォームとターゲットが関数のターゲットと同じ場合は、現在の sharp のインストールに
      // 同梱の libvips があるかを確認する必要がある。lambda で必要になるためである
      if (sharp.vendor.installed.includes(sharp.vendor.current)) {
        // 同梱の libvips がインストールされているので、それを使える
        return undefined
      }
    }

    return checkIfInstalledInInternalPackagesCache(
      {
        needToInstall: true,
        packageName: `sharp`,
        packageVersion:
          sharp.versions.sharp ?? require(`sharp/package.json`).version,
      },
      functionsTarget
    )
  } catch (e) {
    return undefined
  }
}

async function installMissing(
  packages: Array<IBinaryPackageStatus | undefined>,
  functionsTarget: IPlatformAndArch
): Promise<Array<IBinaryPackageStatus | undefined>> {
  function shouldInstall(
    p: IBinaryPackageStatus | undefined
  ): p is IBinaryPackageStatus {
    return Boolean(p?.needToInstall)
  }

  const packagesToInstall = packages.filter(shouldInstall)

  if (packagesToInstall.length === 0) {
    return packages
  }

  await createInternalPackagesCacheDir(functionsTarget)

  const cacheDir = getInternalPackagesCacheDir(functionsTarget)

  const options: ExecaOptions = {
    stderr: `inherit`,
    cwd: cacheDir,
    env: {
      npm_config_arch: functionsTarget.arch,
      npm_config_platform: functionsTarget.platform,
      // グローバルにインストールされた libvips が sharp の要件を満たしていても、スキップせずに、同梱の libvips を sharp に強制的にダウンロードさせる
      // これにより、生成される関数は自己完結し、関数の実行環境にグローバルで使える（同じ）libvips が
      // あることに依存しなくなる
      SHARP_IGNORE_GLOBAL_LIBVIPS: `1`,
    },
  }

  const npmAdditionalCliArgs = [
    `--no-progress`,
    `--no-audit`,
    `--no-fund`,
    `--loglevel`,
    `error`,
    `--color`,
    `always`,
    `--legacy-peer-deps`,
    `--save-exact`,
    // 対象のプラットフォームは現在のものと異なるかもしれず、force を使うとそれをインストールできる
    `--force`,
  ]

  await execa(
    `npm`,
    [
      `install`,
      ...npmAdditionalCliArgs,
      ...packagesToInstall.map(p => `${p.packageName}@${p.packageVersion}`),
    ],
    options
  )

  return packages.map(info =>
    info
      ? info.needToInstall
        ? {
            ...info,
            needToInstall: false,
            packageLocation: path.posix.join(
              cacheDir,
              `node_modules`,
              info.packageName
            ),
          }
        : info
      : undefined
  )
}

export async function createGraphqlEngineBundle(
  rootDir: string,
  reporter: Reporter,
  isVerbose?: boolean
): Promise<webpack.Compilation | undefined> {
  const state = store.getState()
  const pathPrefix = state.program.prefixPaths
    ? (state.config.pathPrefix ?? ``)
    : ``

  const schemaSnapshotString = await fs.readFile(
    path.join(rootDir, `.cache`, `schema.gql`),
    `utf-8`
  )
  await printQueryEnginePlugins()

  const assetRelocatorUseEntry = {
    loader: require.resolve(`@vercel/webpack-asset-relocator-loader`),
    options: {
      outputAssetBase: `assets`,
    },
  }

  const gatsbyPluginTSRequire = mod.createRequire(
    require.resolve(`gatsby-plugin-typescript`)
  )

  const currentTarget = getCurrentPlatformAndTarget()
  const functionsTarget = getFunctionsTargetPlatformAndTarget()

  const dynamicAliases: Record<string, string> = {}
  let forcedLmdbBinaryModule: string | undefined = undefined

  // パッケージを再利用できるかを確認する前に、現在の lambda のターゲット向けの
  // 内部パッケージのキャッシュディレクトリがセットアップされているようにする必要がある
  await createInternalPackagesCacheDir(functionsTarget)

  const [lmdbPackageInfo, sharpPackageInfo] = await installMissing(
    [
      checkIfNeedToInstallMissingLmdb(functionsTarget),
      checkIfNeedToInstallMissingSharp(functionsTarget, currentTarget),
    ],
    functionsTarget
  )

  if (!lmdbPackageInfo) {
    throw new Error(`Failed to find required LMDB binary`)
  } else if (functionsTarget.platform === `linux`) {
    // 関数の実行プラットフォームは主に linux であり、最もよくテストされている。そのため、テストされていない
    // コードパスを通さないように、その特定のバイナリだけを強制する
    if (lmdbPackageInfo.needToInstall) {
      throw new Error(
        `Failed to locate or install LMDB binary for functions execution platform/arch (${functionsTarget.platform}/${functionsTarget.arch})`
      )
    }

    forcedLmdbBinaryModule = `${lmdbPackageInfo.packageLocation}/node.abi83.glibc.node`
  }

  if (sharpPackageInfo) {
    if (sharpPackageInfo.needToInstall) {
      throw new Error(
        `Failed to locate or install Sharp binary for functions execution platform/arch (${functionsTarget.platform}/${functionsTarget.arch})`
      )
    }
    dynamicAliases[`sharp$`] = sharpPackageInfo.packageLocation
  }

  const compiler = webpack({
    name: `Query Engine`,
    // mode: `production`,
    mode: `none`,
    entry: path.join(__dirname, `entry.js`),
    output: {
      path: outputDir,
      filename: `index.js`,
      libraryTarget: `commonjs`,
    },
    target: `node`,
    externalsPresets: {
      node: false,
    },
    cache: {
      type: `filesystem`,
      name: `graphql-engine`,
      cacheLocation,
      buildDependencies: {
        config: [__filename],
      },
      version: JSON.stringify(functionsTarget),
    },
    // これらは一部の実行時のパスで require されるが、ここでは必要ない
    externals: [
      `cbor-x`, // lmdb-store の optional dep だが、`msgpack`（デフォルト）のエンコーディングを使っているので必要ない
      `electron`, // :shrug: `got` には electron 専用のコードパスがあるようだ
      mod.builtinModules.reduce((acc, builtinModule) => {
        if (builtinModule === `fs`) {
          acc[builtinModule] = `global _actualFsWrapper`
          acc[`node:${builtinModule}`] = `global _actualFsWrapper`
        } else {
          acc[builtinModule] = `commonjs ${builtinModule}`
          acc[`node:${builtinModule}`] = `commonjs ${builtinModule}`
        }

        return acc
      }, {}),
    ],
    module: {
      rules: [
        {
          oneOf: [
            {
              // sharp 専用のローダーの組み合わせ
              test: /node_modules[/\\]sharp[/\\].*\.[cm]?js$/,
              // Node 向けのビルドでは、AMD のサポートを無効にすることが推奨されている
              parser: { amd: false },
              use: [
                assetRelocatorUseEntry,
                {
                  loader: require.resolve(`./sharp-bundling-patch`),
                },
              ],
            },
            {
              // LMBD 専用のローダーの組み合わせ - lmdb が relocator で動くように加工する独自のパッチ -> relocator
              test: /node_modules[/\\]lmdb[/\\].*\.[cm]?js/,
              // Node 向けのビルドでは、AMD のサポートを無効にすることが推奨されている
              parser: { amd: false },
              use: [
                assetRelocatorUseEntry,
                {
                  loader: require.resolve(`./lmdb-bundling-patch`),
                  options: {
                    forcedBinaryModule: forcedLmdbBinaryModule,
                  },
                },
              ],
            },
            {
              // gatsby-node ファイル専用のローダーの組み合わせ - エンジンに不要なライフサイクルを取り除く独自の babel 変換 -> relocator
              test: /gatsby-node\.(cjs|mjs|js|ts)$/,
              // Node 向けのビルドでは、AMD のサポートを無効にすることが推奨されている
              parser: { amd: false },
              use: [
                assetRelocatorUseEntry,
                {
                  loader: require.resolve(
                    `../../utils/webpack/loaders/webpack-remove-exports-loader`
                  ),
                  options: {
                    remove: getApisToRemoveForQueryEngine(),
                    jsx: false,
                  },
                },
              ],
            },
            {
              // lmdb と gatsby-node 以外のすべてのケース向けの汎用ローダー - relocator を適用する以外に特別なことはしない
              // Node のバイナリの再配置のために、".node" ファイルもここに含める
              test: /\.(cjs|mjs|js|ts|node)$/,
              // Node 向けのビルドでは、AMD のサポートを無効にすることが推奨されている
              parser: { amd: false },
              use: assetRelocatorUseEntry,
            },
          ],
        },
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: require.resolve(`babel-loader`),
            options: {
              presets: [
                gatsbyPluginTSRequire.resolve(`@babel/preset-typescript`),
              ],
            },
          },
        },
        {
          test: /\.m?js$/,
          type: `javascript/auto`,
          resolve: {
            byDependency: {
              esm: {
                fullySpecified: false,
              },
            },
          },
        },
        {
          test: /\.txt/,
          type: `asset/resource`,
        },
        {
          test: /\.(graphqls?|gqls?)$/,
          use: {
            loader: require.resolve(`graphql-tag/loader`),
          },
        },
      ],
    },
    resolve: {
      extensions,
      alias: {
        ...dynamicAliases,
        ".cache": process.cwd() + `/.cache/`,

        [require.resolve(`gatsby-cli/lib/reporter/loggers/ink/index.js`)]:
          false,
        inquirer: false,
        // lmdb は 1 つのバージョンだけを読み込む
        lmdb: require.resolve(`lmdb`),
        "ts-node": require.resolve(`./shims/ts-node`),
        "gatsby-sharp$": require.resolve(`./shims/gatsby-sharp`),
        "graphql-import-node$": require.resolve(`./shims/no-op-module`),
        "graphql-import-node/register$":
          require.resolve(`./shims/no-op-module`),
        "babel-runtime/helpers/asyncToGenerator":
          require.resolve(`./shims/no-op-module`), // yurnalist の宣言されていない依存（ただし、ここでは通らないコードパスで使われている）
      },
    },
    plugins: [
      new webpack.EnvironmentPlugin([`GATSBY_CLOUD_IMAGE_CDN`]),
      new webpack.DefinePlugin({
        "process.env.GATSBY_SKIP_WRITING_SCHEMA_TO_FILE": `true`,
        "process.env.NODE_ENV": JSON.stringify(`production`),
        SCHEMA_SNAPSHOT: JSON.stringify(schemaSnapshotString),
        PATH_PREFIX: JSON.stringify(pathPrefix),
        "process.env.GATSBY_LOGGER": JSON.stringify(`yurnalist`),
        "process.env.GATSBY_SLICES": JSON.stringify(
          !!process.env.GATSBY_SLICES
        ),
        "process.env.GATSBY_FUNCTIONS_PLATFORM": JSON.stringify(
          functionsTarget.platform
        ),
        "process.env.GATSBY_FUNCTIONS_ARCH": JSON.stringify(
          functionsTarget.arch
        ),
      }),
      process.env.GATSBY_WEBPACK_LOGGING?.includes(`query-engine`) &&
        new WebpackLoggingPlugin(rootDir, reporter, isVerbose),
    ].filter(Boolean) as Array<webpack.WebpackPluginInstance>,
  })

  return new Promise((resolve, reject) => {
    compiler.run(async (err, stats): Promise<void> => {
      function getResourcePath(
        webpackModule?: Module | NormalModule | ConcatenatedModule | null
      ): string | undefined {
        if (webpackModule && !(webpackModule instanceof ConcatenatedModule)) {
          return (webpackModule as NormalModule).resource
        }

        if (webpackModule?.modules) {
          // ConcatenatedModule はモジュールの集まりなので、実際にパスを得るにはさらに深くたどる必要がある。
          // この時点ではどれなのか分からないので、ここでは最初のモジュールを取得する
          const [firstSubModule] = webpackModule.modules
          return getResourcePath(firstSubModule)
        }

        return undefined
      }

      function iterateModules(
        webpackModules: Set<Module>,
        compilation: Compilation
      ): void {
        for (const webpackModule of webpackModules) {
          if (webpackModule instanceof ConcatenatedModule) {
            iterateModules(
              (webpackModule as ConcatenatedModule).modules,
              compilation
            )
          } else {
            const resourcePath = getResourcePath(webpackModule)
            if (resourcePath?.includes(`ts-node`)) {
              const importedBy = getResourcePath(
                compilation.moduleGraph.getIssuer(webpackModule)
              )
              const structuredError = {
                id: `98011`,
                context: {
                  package: `ts-node`,
                  importedBy,
                  advisory: `Gatsby is supporting TypeScript natively (see https://gatsby.dev/typescript). "ts-node" might not be needed anymore at all, consider removing it.`,
                },
              }
              throw structuredError
            }
          }
        }
      }

      try {
        if (stats?.compilation.modules) {
          iterateModules(stats.compilation.modules, stats.compilation)
        }

        if (!isEqual(functionsTarget, currentTarget)) {
          const binaryFixingPromises: Array<Promise<void>> = []
          // やれやれ - relocator が使う emitAsset は、バイナリを壊してしまうようで、
          // "ELF file's phentsize not the expected size" というエラーになる
          // - サイズの差を参照
          //   > find . -name node.abi83.glibc.node
          // ./.cache/internal-packages/node_modules/@lmdb/lmdb-linux-x64/node.abi83.glibc.node
          // ./.cache/query-engine/assets/node.abi83.glibc.node
          // > ls -al ./.cache/query-engine/assets/node.abi83.glibc.node
          // -rw-r--r-- 1 misiek 197121 1285429 Mar 14 11:36 ./.cache/query-engine/assets/node.abi83.glibc.node
          // > ls -al ./.cache/internal-packages/node_modules/@lmdb/lmdb-linux-x64/node.abi83.glibc.node
          // -rw-r--r-- 1 misiek 197121 693544 Mar 14 11:35 ./.cache/internal-packages/node_modules/@lmdb/lmdb-linux-x64/node.abi83.glibc.node
          // そのため、そのまま直接コピーすることで直そうとしている
          for (const asset of (
            stats?.compilation?.assetsInfo ?? new Map()
          ).keys()) {
            if (asset?.endsWith(`.node`)) {
              const targetRelPath = path.posix.relative(`assets`, asset)
              const assetMeta = getAssetMeta(targetRelPath, stats?.compilation)
              const sourcePath = assetMeta?.path
              if (sourcePath) {
                const dist = path.join(outputDir, asset)
                binaryFixingPromises.push(fs.copyFile(sourcePath, dist))
              }
            }
          }

          await Promise.all(binaryFixingPromises)
        }

        compiler.close(closeErr => {
          if (err) {
            return reject(err)
          }
          if (closeErr) {
            return reject(closeErr)
          }
          return resolve(stats?.compilation)
        })
      } catch (e) {
        reject(e)
      }
    })
  })
}
