// https://github.com/jhnns/rewire/issues/144 を回避するために `let` を使う
/* eslint-disable prefer-const */
let fs = require(`fs`)
let workboxBuild = require(`workbox-build`)
const path = require(`path`)
const { slash } = require(`gatsby-core-utils`)
const { globSync } = require(`glob`)
const _ = require(`lodash`)

let getResourcesFromHTML = require(`./get-resources-from-html`)

exports.onPreBootstrap = ({ cache }) => {
  const appShellSourcePath = path.join(__dirname, `app-shell.js`)
  const appShellTargetPath = path.join(cache.directory, `app-shell.js`)
  fs.copyFileSync(appShellSourcePath, appShellTargetPath)
}

exports.createPages = ({ actions, cache }) => {
  const appShellPath = path.join(cache.directory, `app-shell.js`)
  if (process.env.NODE_ENV === `production`) {
    const { createPage } = actions
    createPage({
      path: `/offline-plugin-app-shell-fallback/`,
      component: slash(appShellPath),
    })
  }
}

let s
const readStats = () => {
  if (s) {
    return s
  } else {
    s = JSON.parse(
      fs.readFileSync(`${process.cwd()}/public/webpack.stats.json`, `utf-8`)
    )
    return s
  }
}

function getAssetsForChunks(chunks) {
  const files = _.flatten(
    chunks.map(chunk => readStats().assetsByChunkName[chunk])
  )
  return _.compact(files)
}

function getPrecachePages(globs, base) {
  const precachePages = []

  globs.forEach(page => {
    // glob 7 と同じ結果になるようにそろえる。glob 8 以降は結果を並べ替えず、
    // Windows ではバックスラッシュをエスケープとして扱い、区切りがバックスラッシュのパスを返す
    const matches = globSync(base + page, { windowsPathsNoEscape: true })
      .map(match => slash(match))
      .sort((a, b) => a.localeCompare(b, `en`))
    matches.forEach(path => {
      const isDirectory = fs.lstatSync(path).isDirectory()
      let precachePath

      if (isDirectory && fs.existsSync(`${path}/index.html`)) {
        precachePath = `${path}/index.html`
      } else if (path.endsWith(`.html`)) {
        precachePath = path
      } else {
        return
      }

      if (precachePages.indexOf(precachePath) === -1) {
        precachePages.push(precachePath)
      }
    })
  })

  return precachePages
}

// Workbox のランタイム（`workbox-sw.js`）の読み込み元を決める。
// `local` のときは、Workbox のライブラリ一式を `public` にコピーする
async function getWorkboxImport(importWorkboxFrom, rootDir) {
  switch (importWorkboxFrom) {
    case `local`: {
      const workboxDirectory = await workboxBuild.copyWorkboxLibraries(rootDir)
      return {
        script: `${workboxDirectory}/workbox-sw.js`,
        modulePathPrefix: workboxDirectory,
      }
    }
    case `cdn`:
      return { script: workboxBuild.getModuleURL(`workbox-sw`) }
    case `disabled`:
      return {}
    default:
      throw new Error(
        `"importWorkboxFrom" must be one of "local", "cdn" or "disabled"`
      )
  }
}

// Workbox 5 以降の `generateSW` は、ランタイムをバンドルした service worker を出力し、
// グローバルの `workbox` を用意しない。`sw-append.js` と利用者の `appendScript` は
// グローバルの `workbox` を使うので、Workbox 4 の `generateSW` と同じ形の
// service worker をここで組み立てる
function generateServiceWorker({
  workboxImport,
  debug,
  cacheId,
  skipWaiting,
  clientsClaim,
  manifestEntries,
  runtimeCaching = [],
}) {
  const lines = []

  if (workboxImport.script) {
    lines.push(`importScripts(${JSON.stringify(workboxImport.script)});`)
  }

  const workboxConfig = {}
  if (workboxImport.modulePathPrefix) {
    workboxConfig.modulePathPrefix = workboxImport.modulePathPrefix
  }
  if (debug !== undefined) {
    workboxConfig.debug = debug
  }
  if (Object.keys(workboxConfig).length > 0) {
    lines.push(`workbox.setConfig(${JSON.stringify(workboxConfig)});`)
  }

  if (cacheId) {
    lines.push(
      `workbox.core.setCacheNameDetails({prefix: ${JSON.stringify(cacheId)}});`
    )
  }
  if (skipWaiting) {
    lines.push(`self.skipWaiting();`)
  }
  if (clientsClaim) {
    lines.push(`workbox.core.clientsClaim();`)
  }

  lines.push(
    `workbox.precaching.precacheAndRoute(${JSON.stringify(
      manifestEntries,
      null,
      2
    )}, {});`
  )

  runtimeCaching.forEach(({ urlPattern, handler, method = `GET`, options }) => {
    const matcher =
      typeof urlPattern === `string`
        ? JSON.stringify(urlPattern)
        : urlPattern.toString()
    const strategyOptions = options ? JSON.stringify(options) : ``
    lines.push(
      `workbox.routing.registerRoute(${matcher}, new workbox.strategies.${handler}(${strategyOptions}), ${JSON.stringify(
        method
      )});`
    )
  })

  return lines.join(`\n`) + `\n`
}

exports.onPostBuild = (
  args,
  {
    precachePages: precachePagesGlobs = [],
    appendScript = null,
    debug = undefined,
    workboxConfig = {},
  }
) => {
  const { pathPrefix, reporter } = args
  const rootDir = `public`

  // app と offline app shell のチャンクの正確なアセットファイル名を取得する
  const files = getAssetsForChunks([
    `app`,
    `webpack-runtime`,
    `component---node-modules-gatsby-plugin-offline-app-shell-js`,
  ])
  const appFile = files.find(file => file.startsWith(`app-`))

  function flat(arr) {
    return Array.prototype.flat ? arr.flat() : [].concat(...arr)
  }

  const offlineShellPath = `${process.cwd()}/${rootDir}/offline-plugin-app-shell-fallback/index.html`
  const precachePages = [
    offlineShellPath,
    ...getPrecachePages(
      precachePagesGlobs,
      `${process.cwd()}/${rootDir}`
    ).filter(page => page !== offlineShellPath),
  ]

  const criticalFilePaths = _.uniq(
    flat(precachePages.map(page => getResourcesFromHTML(page, pathPrefix)))
  )

  const globPatterns = files.concat([
    // criticalFilePaths には HTML ページが含まれない（必要なのはこの 1 つだけである）
    `offline-plugin-app-shell-fallback/index.html`,
    ...criticalFilePaths,
  ])

  const manifests = [`manifest.json`, `manifest.webmanifest`]
  manifests.forEach(file => {
    if (fs.existsSync(`${rootDir}/${file}`)) globPatterns.push(file)
  })

  const options = {
    importWorkboxFrom: `local`,
    globDirectory: rootDir,
    globPatterns,
    modifyURLPrefix: {
      // ユーザーが `pathPrefix` を設定している場合は、
      // デフォルトのプレフィックスを `pathPrefix` に置き換える。
      "/": `${pathPrefix}/`,
    },
    cacheId: `gatsby-plugin-offline`,
    // JS と CSS のファイル、および static ディレクトリ内のものは、キャッシュバスティングしない。
    // これらのファイルは URL が一意で、内容が変わることがないためである
    dontCacheBustURLsMatching: /(\.js$|\.css$|static\/)/,
    runtimeCaching: [
      // cypress のエンドポイントを無視する（テスト専用）
      process.env.CYPRESS_SUPPORT
        ? {
            urlPattern: /\/__cypress\//,
            handler: `NetworkOnly`,
          }
        : false,
      {
        // 再検証が不要なので cacheFirst を使う（RegExp も理由も
        // 上と同じ）
        urlPattern: /(\.js$|\.css$|static\/)/,
        handler: `CacheFirst`,
      },
      {
        // page-data.json ファイル、静的クエリの結果、app-data.json は、
        // コンテンツハッシュが付かない
        urlPattern: /^https?:.*\/page-data\/.*\.json/,
        handler: `StaleWhileRevalidate`,
      },
      {
        // その他のページリソースのランタイムキャッシュを追加する
        urlPattern:
          /^https?:.*\.(png|jpg|jpeg|webp|avif|svg|gif|tiff|js|woff|woff2|json|css)$/,
        handler: `StaleWhileRevalidate`,
      },
      {
        // Google Fonts の CSS（末尾が .css ではないので、指定する必要がある）
        urlPattern: /^https?:\/\/fonts\.googleapis\.com\/css/,
        handler: `StaleWhileRevalidate`,
      },
    ].filter(Boolean),
    skipWaiting: true,
    clientsClaim: true,
  }

  const combinedOptions = _.merge(options, workboxConfig)

  // idb-keyval 6 では、`importScripts` で読み込めるビルドが `dist/umd.js` になった。
  // 出力するファイル名は、これまでと同じ形式のままにする
  const idbKeyvalSource = require.resolve(`idb-keyval/dist/umd.js`)
  const idbKeyvalPackageJson = require(`idb-keyval/package.json`)
  const idbKeyValVersioned = `idb-keyval-${idbKeyvalPackageJson.version}-iife.min.js`
  const idbKeyvalDest = `public/${idbKeyValVersioned}`
  fs.createReadStream(idbKeyvalSource).pipe(fs.createWriteStream(idbKeyvalDest))

  const swDest = `public/sw.js`
  const {
    importWorkboxFrom,
    cacheId,
    runtimeCaching,
    skipWaiting,
    clientsClaim,
    ...manifestOptions
  } = combinedOptions

  return workboxBuild
    .getManifest(manifestOptions)
    .then(async ({ count, size, warnings, manifestEntries }) => {
      if (warnings) warnings.forEach(warning => console.warn(warning))

      fs.writeFileSync(
        swDest,
        generateServiceWorker({
          workboxImport: await getWorkboxImport(importWorkboxFrom, rootDir),
          debug,
          cacheId,
          skipWaiting,
          clientsClaim,
          manifestEntries,
          runtimeCaching,
        })
      )

      const swAppend = fs
        .readFileSync(`${__dirname}/sw-append.js`, `utf8`)
        .replace(/%idbKeyValVersioned%/g, idbKeyValVersioned)
        .replace(/%pathPrefix%/g, pathPrefix)
        .replace(/%appFile%/g, appFile)

      fs.appendFileSync(`public/sw.js`, `\n` + swAppend)

      if (appendScript !== null) {
        let userAppend
        try {
          userAppend = fs.readFileSync(appendScript, `utf8`)
        } catch (e) {
          throw new Error(`Couldn't find the specified offline inject script`)
        }
        fs.appendFileSync(`public/sw.js`, `\n` + userAppend)
      }

      reporter.info(
        `Generated ${swDest}, which will precache ${count} files, totaling ${size} bytes.\n` +
          `The following pages will be precached:\n` +
          precachePages
            .map(path => path.replace(`${process.cwd()}/public`, ``))
            .join(`\n`)
      )
    })
}

const MATCH_ALL_KEYS = /^/
exports.pluginOptionsSchema = function ({ Joi }) {
  // これらは v3 のオプションである: https://www.gatsbyjs.com/plugins/gatsby-plugin-offline/#available-options
  return Joi.object({
    precachePages: Joi.array()
      .items(Joi.string())
      .description(
        `An array of pages whose resources should be precached by the service worker, using an array of globs`
      ),
    appendScript: Joi.string().description(
      `A file (path) to be appended at the end of the generated service worker`
    ),
    debug: Joi.boolean().description(
      `Specifies whether Workbox should show debugging output in the browser console at runtime. When undefined, defaults to showing debug messages on localhost only`
    ),
    workboxConfig: Joi.object({
      importWorkboxFrom: Joi.string(),
      globDirectory: Joi.string(),
      globPatterns: Joi.array().items(Joi.string()),
      modifyURLPrefix: Joi.object().pattern(MATCH_ALL_KEYS, Joi.string()),
      cacheId: Joi.string(),
      dontCacheBustURLsMatching: Joi.object().instance(RegExp),
      maximumFileSizeToCacheInBytes: Joi.number(),
      runtimeCaching: Joi.array().items(
        Joi.object({
          urlPattern: Joi.object().instance(RegExp),
          handler: Joi.string().valid(
            `StaleWhileRevalidate`,
            `CacheFirst`,
            `NetworkFirst`,
            `NetworkOnly`,
            `CacheOnly`
          ),
          options: Joi.object({
            networkTimeoutSeconds: Joi.number(),
          }),
        })
      ),
      skipWaiting: Joi.boolean(),
      clientsClaim: Joi.boolean(),
    })
      .description(`Overrides workbox configuration. Helpful documentation: https://www.gatsbyjs.com/plugins/gatsby-plugin-offline/#overriding-workbox-configuration
      `),
  })
}
