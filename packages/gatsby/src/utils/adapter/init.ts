import reporter from "gatsby-cli/lib/reporter"
import _ from "lodash"
import { createRequire } from "module"
import { join } from "path"
import { emptyDir, ensureDir, outputJson } from "fs-extra"
import { execa, Options as ExecaOptions } from "execa"
import { version as gatsbyVersionFromPackageJson } from "gatsby/package.json"
import { satisfies } from "semver"
import type { AdapterInit } from "./types"
import { preferDefault } from "../../bootstrap/prefer-default"
import { getLatestAdapters } from "../get-latest-gatsby-files"
import { maybeAddFileProtocol } from "../../bootstrap/resolve-js-file-path"

export const getAdaptersCacheDir = (): string =>
  join(process.cwd(), `.cache/adapters`)

const createAdaptersCacheDir = async (): Promise<void> => {
  await ensureDir(getAdaptersCacheDir())
  await emptyDir(getAdaptersCacheDir())

  const packageJsonPath = join(getAdaptersCacheDir(), `package.json`)

  await outputJson(packageJsonPath, {
    name: `gatsby-adapters`,
    description: `This directory contains adapters that have been automatically installed by Gatsby.`,
    version: `1.0.0`,
    private: true,
    author: `Gatsby`,
    license: `MIT`,
  })
}

interface IAdapterToUse {
  name: string
  module: string
  gatsbyVersion: string
  moduleVersion: string
}

const tryLoadingAlreadyInstalledAdapter = async ({
  adapterToUse,
  installLocation,
  currentGatsbyVersion,
}: {
  adapterToUse: IAdapterToUse
  currentGatsbyVersion: string
  installLocation: string
}): Promise<
  | {
      found: false
    }
  | ({
      found: true
      installedVersion: string
    } & (
      | {
          compatible: false
          incompatibilityReason: string
        }
      | {
          compatible: true
          loadedModule: AdapterInit
        }
    ))
> => {
  try {
    const locationRequire = createRequire(`${installLocation}/:internal:`)
    const adapterPackageJson = locationRequire(
      `${adapterToUse.module}/package.json`
    )
    const adapterPackageVersion = adapterPackageJson?.version

    // インストールされているアダプターのバージョンが現在の Gatsby のバージョンと互換性があるかを、マニフェストに基づいて確認する
    if (
      !satisfies(adapterPackageVersion, adapterToUse.moduleVersion, {
        includePrerelease: true,
      })
    ) {
      return {
        found: true,
        compatible: false,
        installedVersion: adapterPackageVersion,
        incompatibilityReason: `Used gatsby version "${currentGatsbyVersion}" requires "${adapterToUse.module}@${adapterToUse.moduleVersion}". Installed "${adapterToUse.module}" version: "${adapterPackageVersion}".`,
      }
    }

    const required = maybeAddFileProtocol(
      locationRequire.resolve(adapterToUse.module)
    )
    if (required) {
      return {
        found: true,
        compatible: true,
        installedVersion: adapterPackageVersion,
        loadedModule: preferDefault(
          preferDefault(await import(required))
        ) as AdapterInit,
      }
    } else {
      return {
        found: false,
      }
    }
  } catch (e) {
    return {
      found: false,
    }
  }
}

const handleAdapterProblem = (
  message: string,
  panicFn = reporter.panic
): never | undefined => {
  if (!process.env.GATSBY_CONTINUE_BUILD_ON_ADAPTER_MISMATCH) {
    panicFn(
      `${message}\n\nZero-configuration deployment failed to avoid potentially broken deployment.\nIf you want build to continue despite above problems:\n - configure adapter manually in gatsby-config which will skip zero-configuration deployment attempt\n - or set GATSBY_CONTINUE_BUILD_ON_MISSING_ADAPTER=true environment variable to continue build without an adapter.`
    )
  } else {
    reporter.warn(
      `${message}\n\nContinuing build using without using any adapter due to GATSBY_CONTINUE_BUILD_ON_MISSING_ADAPTER environment variable being set`
    )
  }
  return undefined
}

export async function getAdapterInit(
  currentGatsbyVersion: string = gatsbyVersionFromPackageJson
): Promise<AdapterInit | undefined> {
  // 0. 最新のアダプターのマニフェストの取得を試みる。失敗した場合は、現在のバージョンの gatsby に同梱されているマニフェストで続行する
  const latestAdapters = await getLatestAdapters()

  // 1. 現在の環境と互換性のあるアダプターの候補を探す
  //    将来パッケージの名前が変わり、将来の gatsby のバージョンが以前とは別のパッケージを必要とする場合に備えて、一致するすべてのアダプターを探す
  const adapterEntry = latestAdapters.find(candidate => candidate.test())

  if (!adapterEntry) {
    reporter.verbose(
      `No adapter was found for the current environment. Skipping adapter initialization.`
    )
    return undefined
  }

  // 2. マニフェストのエントリーの中から、現在の Gatsby のバージョンに対応するものを探し、使うべきバージョンを特定する
  //   最初に一致したものを使う。
  let adapterToUse: IAdapterToUse | undefined = undefined

  for (const versionEntry of adapterEntry.versions) {
    if (
      satisfies(currentGatsbyVersion, versionEntry.gatsbyVersion, {
        includePrerelease: true,
      })
    ) {
      adapterToUse = {
        name: adapterEntry.name,
        module: versionEntry.module ?? adapterEntry.module,
        gatsbyVersion: versionEntry.gatsbyVersion,
        moduleVersion: versionEntry.moduleVersion,
      }
      break
    }
  }

  if (!adapterToUse) {
    return handleAdapterProblem(
      `No version of ${adapterEntry.name} adapter is compatible with your current Gatsby version ${currentGatsbyVersion}.`
    )
  }

  {
    // 3. ユーザーがアダプターを手動でインストールしているかを確認し、そこからの解決を試みる
    const adapterInstalledByUserResults =
      await tryLoadingAlreadyInstalledAdapter({
        adapterToUse,
        installLocation: process.cwd(),
        currentGatsbyVersion,
      })
    if (adapterInstalledByUserResults.found) {
      if (adapterInstalledByUserResults.compatible) {
        reporter.verbose(
          `Using site's adapter dependency "${adapterToUse.module}@${adapterInstalledByUserResults.installedVersion}"`
        )
        return adapterInstalledByUserResults.loadedModule
      } else {
        reporter.warn(
          `Ignoring incompatible ${adapterToUse.module}@${adapterInstalledByUserResults.installedVersion} installed by site. ${adapterInstalledByUserResults.incompatibilityReason}`
        )
      }
    }
  }

  {
    // 4. 以前の実行で正しいアダプターがすでに .cache/adapters にインストールされているかを確認し、そこからの解決を試みる
    const adapterPreviouslyInstalledInCacheAdaptersResults =
      await tryLoadingAlreadyInstalledAdapter({
        adapterToUse,
        installLocation: getAdaptersCacheDir(),
        currentGatsbyVersion,
      })

    if (adapterPreviouslyInstalledInCacheAdaptersResults.found) {
      if (adapterPreviouslyInstalledInCacheAdaptersResults.compatible) {
        reporter.verbose(
          `Using previously adapter previously installed by gatsby "${adapterToUse.module}@${adapterPreviouslyInstalledInCacheAdaptersResults.installedVersion}"`
        )
        return adapterPreviouslyInstalledInCacheAdaptersResults.loadedModule
      } else {
        reporter.verbose(
          `Ignoring incompatible ${adapterToUse.module} installed by gatsby in ".cache/adapters" before. ${adapterPreviouslyInstalledInCacheAdaptersResults.incompatibilityReason}`
        )
      }
    }
  }

  {
    // 5. ユーザーがアダプターを手動でインストールしていないか互換性がなく、かつ gatsby がインストールしたキャッシュ済みのバージョンがないか、そのバージョンに互換性がない場合は、
    //    互換性のあるバージョンを .cache/adapters にインストールすることを試みる
    const installTimer = reporter.activityTimer(
      `Installing ${adapterToUse.name} adapter (${adapterToUse.module}@${adapterToUse.moduleVersion})`
    )

    try {
      installTimer.start()
      await createAdaptersCacheDir()

      const options: ExecaOptions = {
        stderr: `inherit`,
        cwd: getAdaptersCacheDir(),
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
      ]

      await execa(
        `npm`,
        [
          `install`,
          ...npmAdditionalCliArgs,
          `${adapterToUse.module}@${adapterToUse.moduleVersion}`,
        ],
        options
      )
    } catch (e) {
      return handleAdapterProblem(
        `Could not install adapter "${adapterToUse.module}@${adapterToUse.moduleVersion}". Please install it yourself by adding it to your package.json's dependencies and try building your project again.`,
        installTimer.panic
      )
    }

    installTimer.end()
  }

  {
    // 5. ".cache/adapters" からの読み込みをもう一度試みる
    const adapterAutoInstalledInCacheAdaptersResults =
      await tryLoadingAlreadyInstalledAdapter({
        adapterToUse,
        installLocation: getAdaptersCacheDir(),
        currentGatsbyVersion,
      })

    if (adapterAutoInstalledInCacheAdaptersResults.found) {
      if (adapterAutoInstalledInCacheAdaptersResults.compatible) {
        reporter.info(
          `If you plan on staying on this deployment platform, consider installing "${adapterToUse.module}@${adapterToUse.moduleVersion}" as a dependency in your project. This will give you faster and more robust installs.`
        )
        return adapterAutoInstalledInCacheAdaptersResults.loadedModule
      } else {
        // これはバグを示している。マニフェストの範囲に合うバージョンをインストールしたのに、アダプターを読み込んでみると互換性がないと判断しているためである
        return handleAdapterProblem(
          `Auto installed adapter "${adapterToUse.module}@${adapterAutoInstalledInCacheAdaptersResults.installedVersion}"`
        )
      }
    } else {
      // これは、アダプター自体のバグ（メインのエントリーポイントを解決できない）か、アダプターを読み込むロジックのバグを示している
      return handleAdapterProblem(
        `Could not load adapter "${adapterToUse.module}@${adapterToUse.moduleVersion}". Adapter entry point is not resolvable.`
      )
    }
  }
}
