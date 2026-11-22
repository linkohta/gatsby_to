import type { RoutesManifest, HeaderRoutes } from "gatsby"
import { tmpdir } from "os"
import { Transform } from "stream"
import { join, basename } from "path"
import fs from "fs-extra"
import { createStaticAssetsPathHandler } from "./pretty-urls"

const NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST = new Set([
  `query`,
  `conditions`,
  `headers`,
  `signed`,
  `edge_handler`,
])

const NETLIFY_CONDITIONS_ALLOWLIST = new Set([`language`, `country`])

const toNetlifyPath = (fromPath: string, toPath: string): Array<string> => {
  // クエリパラメーターのリダイレクトを書き換える。ほかの fromPath の文字列には影響しない
  const netlifyFromPath = fromPath.replace(/[&?]/, ` `)
  // ワイルドカードとスプラットのリダイレクトを書き換える。ほかの toPath の文字列には影響しない
  const netlifyToPath = toPath.replace(/\*/, `:splat`)

  return [netlifyFromPath, netlifyToPath]
}
export const ADAPTER_MARKER_START = `# gatsby-adapter-netlify start`
export const ADAPTER_MARKER_END = `# gatsby-adapter-netlify end`
export const NETLIFY_PLUGIN_MARKER_START = `# @netlify/plugin-gatsby redirects start`
export const NETLIFY_PLUGIN_MARKER_END = `# @netlify/plugin-gatsby redirects end`
export const GATSBY_PLUGIN_MARKER_START = `## Created with gatsby-plugin-netlify`

export async function injectEntries(
  fileName: string,
  content: string
): Promise<void> {
  await fs.ensureFile(fileName)

  const tmpFile = join(
    await fs.mkdtemp(join(tmpdir(), basename(fileName))),
    `out.txt`
  )

  let tail = ``
  let insideNetlifyPluginGatsby = false
  let insideGatsbyPluginNetlify = false
  let insideGatsbyAdapterNetlify = false
  let injectedEntries = false

  const annotatedContent = `${ADAPTER_MARKER_START}\n${content}\n${ADAPTER_MARKER_END}\n`

  function getContentToAdd(final: boolean): string {
    const lines = tail.split(`\n`)
    tail = ``

    let contentToAdd = ``
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (!final && i === lines.length - 1) {
        tail = line
        break
      }

      let skipLine =
        insideGatsbyAdapterNetlify ||
        insideGatsbyPluginNetlify ||
        insideNetlifyPluginGatsby

      if (line.includes(ADAPTER_MARKER_START)) {
        skipLine = true
        insideGatsbyAdapterNetlify = true
      } else if (line.includes(ADAPTER_MARKER_END)) {
        insideGatsbyAdapterNetlify = false
        contentToAdd += annotatedContent
        injectedEntries = true
      } else if (line.includes(NETLIFY_PLUGIN_MARKER_START)) {
        insideNetlifyPluginGatsby = true
        skipLine = true
      } else if (line.includes(NETLIFY_PLUGIN_MARKER_END)) {
        insideNetlifyPluginGatsby = false
      } else if (line.includes(GATSBY_PLUGIN_MARKER_START)) {
        insideGatsbyPluginNetlify = true
        skipLine = true
      }

      if (!skipLine) {
        contentToAdd += line + `\n`
      }
    }

    return contentToAdd
  }

  const streamReplacer = new Transform({
    transform(chunk, _encoding, callback): void {
      tail = tail + chunk.toString()

      try {
        callback(null, getContentToAdd(false))
      } catch (e) {
        callback(e)
      }
    },
    flush(callback): void {
      try {
        let contentToAdd = getContentToAdd(true)
        if (!injectedEntries) {
          contentToAdd += annotatedContent
        }
        callback(null, contentToAdd)
      } catch (e) {
        callback(e)
      }
    },
  })

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpFile)
    const pipeline = fs
      .createReadStream(fileName)
      .pipe(streamReplacer)
      .pipe(writeStream)

    pipeline.on(`finish`, resolve)
    pipeline.on(`error`, reject)
    streamReplacer.on(`error`, reject)
  })

  // 以前のファイルを削除し、新しいファイルを tmp から最終的なパスへ移動する
  await fs.remove(fileName)
  await fs.move(tmpFile, fileName)
}

function buildHeaderString(path, headers): string {
  return `${encodeURI(path)}\n${headers.reduce((acc, curr) => {
    acc += `  ${curr.key}: ${curr.value}\n`
    return acc
  }, ``)}`
}

export function processRoutesManifest(
  routesManifest: RoutesManifest,
  headerRoutes: HeaderRoutes
): {
  redirects: string
  headers: string
  lambdasThatUseCaching: Map<string, string>
  fileMovingPromise: Promise<void>
} {
  const lambdasThatUseCaching = new Map<string, string>()

  const { ensureStaticAssetPath, fileMovingDone } =
    createStaticAssetsPathHandler()

  let _redirects = ``
  let _headers = ``
  for (const route of routesManifest) {
    const fromPath = route.path.replace(/\*.*/, `*`)

    if (route.type === `function`) {
      let functionName = route.functionId
      if (route.cache) {
        functionName = `${route.functionId}-odb`
        if (!lambdasThatUseCaching.has(route.functionId)) {
          lambdasThatUseCaching.set(route.functionId, functionName)
        }
      }

      const invocationURL = `/.netlify/${
        route.cache ? `builders` : `functions`
      }/${functionName}`
      _redirects += `${encodeURI(fromPath)}  ${invocationURL}  200\n`
    } else if (route.type === `redirect`) {
      const {
        status: routeStatus,
        toPath,
        // TODO: ヘッダーの処理を追加する
        headers,
        ...rest
      } = route
      let status = String(routeStatus)

      if (rest.force) {
        status = `${status}!`
      }

      const [netlifyFromPath, netlifyToPath] = toNetlifyPath(fromPath, toPath)

      // 最初の 3 つのパラメーターは順序に意味がある。
      // 残りのパラメーター（キーと値のペア）の順序は任意である。
      const pieces = [netlifyFromPath, netlifyToPath, status]

      for (const [key, value] of Object.entries(rest)) {
        if (NETLIFY_REDIRECT_KEYWORDS_ALLOWLIST.has(key)) {
          if (key === `conditions`) {
            // Gatsby の "conditions" キーには "language" と "country" しか含まれず、
            // Netlify の _redirects に合わせるには特別な変換が必要である
            // https://www.gatsbyjs.com/docs/reference/config-files/actions/#createRedirect
            if (value && typeof value === `object`) {
              for (const [conditionKey, conditionValueRaw] of Object.entries(
                value
              )) {
                if (NETLIFY_CONDITIONS_ALLOWLIST.has(conditionKey)) {
                  const conditionValue = Array.isArray(conditionValueRaw)
                    ? conditionValueRaw.join(`,`)
                    : conditionValueRaw
                  // Gatsby が渡してくるのは "country" だが、必要なのは "Country" である
                  const conditionName =
                    conditionKey.charAt(0).toUpperCase() + conditionKey.slice(1)

                  pieces.push(`${conditionName}=${conditionValue}`)
                }
              }
            }
          } else {
            pieces.push(`${key}=${value}`)
          }
        }
      }
      _redirects += pieces.join(`  `) + `\n`
    } else if (route.type === `static`) {
      const { finalFilePath, isDynamic } = ensureStaticAssetPath(
        route.filePath,
        fromPath
      )

      if (isDynamic) {
        _redirects += `${encodeURI(fromPath)}  ${finalFilePath.replace(
          /^public/,
          ``
        )}  200\n`
      }

      if (!headerRoutes) {
        // headerRoutes が渡されている場合は、routesManifest から _headers を生成しない
        _headers += buildHeaderString(route.path, route.headers)
      }
    }
  }

  if (headerRoutes) {
    _headers = headerRoutes.reduce((acc, curr) => {
      acc += buildHeaderString(curr.path, curr.headers)
      return acc
    }, ``)
  }

  return {
    redirects: _redirects,
    headers: _headers,
    lambdasThatUseCaching,
    fileMovingPromise: fileMovingDone(),
  }
}

export async function handleRoutesManifest(
  routesManifest: RoutesManifest,
  headerRoutes: HeaderRoutes
): Promise<{
  lambdasThatUseCaching: Map<string, string>
}> {
  const { redirects, headers, lambdasThatUseCaching, fileMovingPromise } =
    processRoutesManifest(routesManifest, headerRoutes)

  await injectEntries(`public/_redirects`, redirects)
  await injectEntries(`public/_headers`, headers)
  await fileMovingPromise

  return {
    lambdasThatUseCaching,
  }
}
