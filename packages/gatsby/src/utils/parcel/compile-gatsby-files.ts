import { Parcel } from "@parcel/core"
import { LMDBCache, Cache } from "@parcel/cache"
import path from "path"
import type { Diagnostic } from "@parcel/diagnostic"
import reporter from "gatsby-cli/lib/reporter"
import { WorkerPool } from "gatsby-worker"
import { ensureDir, emptyDir, existsSync, remove, readdir } from "fs-extra"
import { isNearMatch } from "../is-near-match"

export const COMPILED_CACHE_DIR = `.cache/compiled`
export const PARCEL_CACHE_DIR = `.cache/.parcel-cache`
export const gatsbyFileRegex = `gatsby-+(node|config).ts`
const RETRY_COUNT = 5

function getCacheDir(siteRoot: string): string {
  return `${siteRoot}/${PARCEL_CACHE_DIR}`
}

function exponentialBackoff(retry: number): Promise<void> {
  if (retry === 0) {
    return Promise.resolve()
  }
  const timeout = 50 * Math.pow(2, retry)
  return new Promise(resolve => setTimeout(resolve, timeout))
}

/**
 * 設定を指定して Parcel を構築する。
 * @see {@link https://parceljs.org/features/targets/}
 */
export function constructParcel(siteRoot: string, cache?: Cache): Parcel {
  return new Parcel({
    entries: [
      `${siteRoot}/${gatsbyFileRegex}`,
      `${siteRoot}/plugins/**/${gatsbyFileRegex}`,
    ],
    defaultConfig: require.resolve(`gatsby-parcel-config`),
    mode: `production`,
    cache,
    targets: {
      root: {
        outputFormat: `commonjs`,
        includeNodeModules: false,
        sourceMap: process.env.NODE_ENV === `development`,
        engines: {
          node: _CFLAGS_.GATSBY_MAJOR === `5` ? `>= 18.0.0` : `>= 14.15.0`,
        },
        distDir: `${siteRoot}/${COMPILED_CACHE_DIR}`,
      },
    },
    cacheDir: getCacheDir(siteRoot),
  })
}

interface IProcessBundle {
  filePath: string
  mainEntryPath?: string
}

type RunParcelReturn = Array<IProcessBundle>

export async function runParcel(siteRoot: string): Promise<RunParcelReturn> {
  const cache = new LMDBCache(getCacheDir(siteRoot)) as unknown as Cache
  const parcel = constructParcel(siteRoot, cache)
  const { bundleGraph } = await parcel.run()
  const bundles = bundleGraph.getBundles()
  // bundles はシリアライズできないので、IPC の境界を越えられるように、
  // 必要なデータを取り出す必要がある
  return bundles.map(bundle => {
    return {
      filePath: bundle.filePath,
      mainEntryPath: bundle.getMainEntry()?.filePath,
    }
  })
}

/**
 * 既知の gatsby-* ファイル（例: `gatsby-config`、`gatsby-node`）をコンパイルして、
 * `<SITE_ROOT>/.cache/compiled` に出力する。
 */
export async function compileGatsbyFiles(
  siteRoot: string,
  retry: number = 0
): Promise<void> {
  try {
    const gatsbyNodeName = `gatsby-node`

    // gatsby-node.jsx と gatsby-node.tsx（やその他の誤った名前のバリエーション）がないかを確認する
    // ディレクトリ名を取り除きたいので、"withFileTypes" を使う
    // "withFileTypes" を使うと、配列には <fs.Dirent> オブジェクトが入る
    const filesAndDirectories = await readdir(siteRoot, { withFileTypes: true })
    const files = filesAndDirectories
      .filter(i => !i.isDirectory())
      .map(i => i.name)

    let nearMatch = ``

    for (const file of files) {
      if (nearMatch) {
        break
      }

      const { name } = path.parse(file)
      // もちろん、有効な gatsby-node ファイルは許可する
      if (
        file === `gatsby-node.js` ||
        file === `gatsby-node.mjs` ||
        file === `gatsby-node.ts`
      ) {
        break
      }

      // 誤った名前の可能性が高いファイルを確認する
      if (isNearMatch(name, gatsbyNodeName, 3)) {
        nearMatch = file
      }
    }

    // gatsby-node の名前が誤っている
    if (nearMatch) {
      const isTSX = nearMatch.endsWith(`.tsx`)
      reporter.panic({
        id: `10128`,
        context: {
          configName: gatsbyNodeName,
          nearMatch,
          isTSX,
        },
      })
    }

    const worker = new WorkerPool<typeof import("./compile-gatsby-files")>(
      require.resolve(`./compile-gatsby-files`),
      {
        numWorkers: 1,
      }
    )

    const distDir = `${siteRoot}/${COMPILED_CACHE_DIR}`
    await ensureDir(distDir)
    await emptyDir(distDir)

    await exponentialBackoff(retry)

    let bundles: RunParcelReturn = []
    try {
      // parcel は segfault を起こすことがあり、そこからは復旧できない。そのため parcel を
      // 子プロセスで実行し、失敗した場合は parcel のキャッシュを削除して（これで segfault の原因に
      // なっている問題が「直る」ようだ）、数回再試行する
      // 理想的ではないが、gatsby が segfault を起こすのは非常にストレスが大きい。一般的な対処法は .cache 全体を
      // 消すことだが、それもユーザーにとって理想的ではない。parcel のキャッシュだけを削除して
      // 自動的に復旧できるなら、なおさらである
      bundles = await worker.single.runParcel(siteRoot)
    } catch (error) {
      if (error.diagnostics) {
        handleErrors(error.diagnostics)
        return
      } else if (retry >= RETRY_COUNT) {
        reporter.panic({
          id: `11904`,
          error,
          context: {
            siteRoot,
            retries: RETRY_COUNT,
            sourceMessage: error.message,
          },
        })
      } else {
        await exponentialBackoff(retry)
        try {
          await remove(getCacheDir(siteRoot))
        } catch {
          // windows では、LMDB のクローズに失敗すると "EBUSY" エラーになることがある。この try/catch は、
          // EBUSY エラーが本当の import エラーを隠してしまうのを防ぐためのものである
        }
        await compileGatsbyFiles(siteRoot, retry + 1)
        return
      }
    } finally {
      worker.end()
    }

    await exponentialBackoff(retry)

    if (bundles.length === 0) return

    let compiledTSFilesCount = 0
    for (const bundle of bundles) {
      // 出力が存在し、有効であることを検証する
      try {
        delete require.cache[bundle.filePath]
        require(bundle.filePath)
      } catch (e) {
        if (retry >= RETRY_COUNT) {
          reporter.panic({
            id: `11904`,
            context: {
              siteRoot,
              retries: RETRY_COUNT,
              compiledFileLocation: bundle.filePath,
              sourceFileLocation: bundle.mainEntryPath,
            },
          })
        } else if (retry > 0) {
          // 最初の再試行が最も不安定で、その後は常に良い状態になるようだ。
          // おそらく、キャッシュの消去が問題を直す決め手になっている
          reporter.verbose(
            `Failed to import compiled file "${
              bundle.filePath
            }" after retry, attempting another retry (#${
              retry + 1
            } of ${RETRY_COUNT}) - "${e.message}"`
          )
        }

        try {
          await remove(getCacheDir(siteRoot))
        } catch {
          // windows では、LMDB のクローズに失敗すると "EBUSY" エラーになることがある。この try/catch は、
          // EBUSY エラーが本当の import エラーを隠してしまうのを防ぐためのものである
        }

        await compileGatsbyFiles(siteRoot, retry + 1)
        return
      }

      const mainEntry = bundle.mainEntryPath
      // 共有チャンクには mainEntry が存在しない
      if (mainEntry) {
        if (mainEntry.endsWith(`.ts`)) {
          compiledTSFilesCount = compiledTSFilesCount + 1
        }
      }
    }
  } catch (error) {
    if (error.diagnostics) {
      handleErrors(error.diagnostics)
    } else {
      reporter.panic({
        id: `11903`,
        error,
        context: {
          siteRoot,
          sourceMessage: error.message,
        },
      })
    }
  }
}

function handleErrors(diagnostics: Array<Diagnostic>): void {
  diagnostics.forEach(err => {
    if (err.codeFrames) {
      err.codeFrames.forEach(c => {
        // codeHighlights の配列には常にエントリーが 1 つしかないと仮定している。ローカルでのテストでは、1 つしか現れなかった
        const codeHighlightsMessage = c?.codeHighlights[0]?.message
        // 両方のメッセージが同じ場合は、具体的なほうを出力しない。そうしないと重複してしまう
        const specificMessage =
          codeHighlightsMessage === err.message
            ? undefined
            : codeHighlightsMessage
        reporter.panic({
          id: `11901`,
          context: {
            filePath: c?.filePath,
            generalMessage: err.message,
            specificMessage,
            origin: err?.origin,
            hints: err?.hints,
          },
        })
      })
    } else {
      reporter.panic({
        id: `11901`,
        context: {
          generalMessage: err.message,
          origin: err?.origin,
          hints: err?.hints,
        },
      })
    }
  })
}

export function getResolvedFieldsForPlugin(
  rootDir: string,
  pluginName: string
): {
  resolvedCompiledGatsbyNode?: string
} {
  return {
    resolvedCompiledGatsbyNode: findCompiledLocalPluginModule(
      rootDir,
      pluginName,
      `gatsby-node`
    ),
  }
}

export function findCompiledLocalPluginModule(
  rootDir: string,
  pluginName: string,
  moduleName: "gatsby-config" | "gatsby-node"
): string | undefined {
  const compiledPathForPlugin =
    pluginName === `default-site-plugin`
      ? `${rootDir}/${COMPILED_CACHE_DIR}`
      : `${rootDir}/${COMPILED_CACHE_DIR}/plugins/${pluginName}`

  const compiledPathForModule = `${compiledPathForPlugin}/${moduleName}.js`

  const isCompiled = existsSync(compiledPathForModule)
  if (isCompiled) {
    return compiledPathForModule
  }

  return undefined
}
