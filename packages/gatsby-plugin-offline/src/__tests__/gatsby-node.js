import { testPluginOptionsSchema } from "gatsby-plugin-utils"
import { pluginOptionsSchema } from "../gatsby-node"
const rewire = require(`rewire`)
const fs = require(`fs`)
const path = require(`path`)

describe(`getPrecachePages`, () => {
  const gatsbyNode = rewire(`../gatsby-node`)
  const getPrecachePages = gatsbyNode.__get__(`getPrecachePages`)

  it(`correctly matches pages`, () => {
    const base = `${__dirname}/fixtures/public`

    const allPages = getPrecachePages([`**/*`], base)
    expect(allPages.map(page => path.normalize(page))).toMatchSnapshot()

    const dir1Pages = getPrecachePages([`/dir1/*`], base)
    expect(dir1Pages.map(page => path.normalize(page))).toMatchSnapshot()
  })
})

describe(`onPostBuild`, () => {
  let swText = ``
  const gatsbyNode = rewire(`../gatsby-node`)

  const componentChunkName = `chunkName`
  const chunks = [`chunk1`, `chunk2`]

  // webpack.stats.json をモックする
  const stats = {
    assetsByChunkName: {
      [componentChunkName]: chunks,
    },
  }

  // ファイルシステムの関数をモックする
  const mockFs = {
    ...fs,

    readFileSync(file) {
      if (file === `${process.cwd()}/public/webpack.stats.json`) {
        return JSON.stringify(stats)
      } else if (file === `public/sw.js`) {
        return swText
      } else if (file.match(/\/sw-append\.js/)) {
        return ``
      } else {
        return fs.readFileSync(file)
      }
    },

    appendFileSync(file, text) {
      swText += text
    },

    writeFileSync(file, text) {
      swText = text
    },

    createReadStream() {
      return { pipe() {} }
    },

    createWriteStream() {},
  }

  let manifestOptions
  const mockWorkboxBuild = {
    getManifest(options) {
      manifestOptions = options
      return Promise.resolve({
        count: 1,
        size: 1,
        warnings: [],
        manifestEntries: [
          { url: `app-123.js`, revision: null },
          {
            url: `offline-plugin-app-shell-fallback/index.html`,
            revision: `abc`,
          },
        ],
      })
    },
    copyWorkboxLibraries(directory) {
      expect(directory).toBe(`public`)
      return Promise.resolve(`workbox-v7.0.0`)
    },
    getModuleURL(moduleName) {
      return `https://cdn.example/${moduleName}.js`
    },
  }

  gatsbyNode.__set__(`fs`, mockFs)
  gatsbyNode.__set__(`getResourcesFromHTML`, () => [])
  gatsbyNode.__set__(`workboxBuild`, mockWorkboxBuild)
  gatsbyNode.__set__(`console`, { log() {} })

  const args = {
    pathPrefix: ``,
    reporter: {
      info(message) {
        console.log(message)
      },
    },
  }

  beforeEach(() => {
    swText = ``
    manifestOptions = undefined
  })

  it(`appends to sw.js`, async () => {
    await gatsbyNode.onPostBuild(args, {
      appendScript: `${__dirname}/fixtures/custom-sw-code.js`,
    })

    expect(swText).toContain(`console.log(\`Hello, world!\`)`)
  })

  it(`generates a service worker that exposes the workbox global`, async () => {
    await gatsbyNode.onPostBuild(args, {})

    expect(swText).toContain(`importScripts("workbox-v7.0.0/workbox-sw.js");`)
    expect(swText).toContain(
      `workbox.setConfig({"modulePathPrefix":"workbox-v7.0.0"});`
    )
    expect(swText).toContain(
      `workbox.core.setCacheNameDetails({prefix: "gatsby-plugin-offline"});`
    )
    expect(swText).toContain(`self.skipWaiting();`)
    expect(swText).toContain(`workbox.core.clientsClaim();`)
    expect(swText).toMatch(
      /workbox\.precaching\.precacheAndRoute\(\[\s+\{\s+"url": "app-123\.js",\s+"revision": null/
    )
    expect(swText).toContain(
      `workbox.routing.registerRoute(/(\\.js$|\\.css$|static\\/)/, new workbox.strategies.CacheFirst(), "GET");`
    )
    expect(swText).toContain(
      `workbox.routing.registerRoute(/^https?:.*\\/page-data\\/.*\\.json/, new workbox.strategies.StaleWhileRevalidate(), "GET");`
    )
  })

  it(`passes only the manifest options to Workbox`, async () => {
    await gatsbyNode.onPostBuild(args, {
      workboxConfig: { maximumFileSizeToCacheInBytes: 1000 },
    })

    expect(Object.keys(manifestOptions).sort()).toEqual([
      `dontCacheBustURLsMatching`,
      `globDirectory`,
      `globPatterns`,
      `maximumFileSizeToCacheInBytes`,
      `modifyURLPrefix`,
    ])
    expect(manifestOptions.globDirectory).toBe(`public`)
  })

  it(`configures the Workbox debug option`, async () => {
    await gatsbyNode.onPostBuild(args, { debug: true })

    expect(swText).toContain(
      `workbox.setConfig({"modulePathPrefix":"workbox-v7.0.0","debug":true});`
    )
  })

  it(`imports Workbox from the CDN`, async () => {
    await gatsbyNode.onPostBuild(args, {
      workboxConfig: { importWorkboxFrom: `cdn` },
    })

    expect(swText).toContain(
      `importScripts("https://cdn.example/workbox-sw.js");`
    )
    expect(swText).not.toContain(`modulePathPrefix`)
  })

  it(`does not import Workbox when importWorkboxFrom is disabled`, async () => {
    await gatsbyNode.onPostBuild(args, {
      workboxConfig: { importWorkboxFrom: `disabled` },
    })

    expect(swText).not.toContain(`importScripts(`)
    expect(swText).not.toContain(`workbox.setConfig`)
  })

  it(`rejects an unknown importWorkboxFrom value`, async () => {
    await expect(
      gatsbyNode.onPostBuild(args, {
        workboxConfig: { importWorkboxFrom: `somewhere` },
      })
    ).rejects.toThrow(
      `"importWorkboxFrom" must be one of "local", "cdn" or "disabled"`
    )
  })

  it(`applies the options and settings of runtimeCaching and the service worker`, async () => {
    await gatsbyNode.onPostBuild(args, {
      workboxConfig: {
        cacheId: `my-site`,
        skipWaiting: false,
        clientsClaim: false,
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: `NetworkFirst`,
            options: { networkTimeoutSeconds: 3 },
          },
        ],
      },
    })

    expect(swText).toContain(
      `workbox.core.setCacheNameDetails({prefix: "my-site"});`
    )
    expect(swText).not.toContain(`self.skipWaiting();`)
    expect(swText).not.toContain(`workbox.core.clientsClaim();`)
    expect(swText).toContain(
      `workbox.routing.registerRoute(/\\/api\\//, new workbox.strategies.NetworkFirst({"networkTimeoutSeconds":3}), "GET");`
    )
  })
})

describe(`pluginOptionsSchema`, () => {
  it(`should provide meaningful errors when fields are invalid`, async () => {
    const expectedErrors = [
      `"precachePages[0]" must be a string`,
      `"precachePages[1]" must be a string`,
      `"precachePages[2]" must be a string`,
      `"appendScript" must be a string`,
      `"debug" must be a boolean`,
      `"workboxConfig.importWorkboxFrom" must be a string`,
      `"workboxConfig.globDirectory" must be a string`,
      `"workboxConfig.globPatterns[0]" must be a string`,
      `"workboxConfig.globPatterns[1]" must be a string`,
      `"workboxConfig.globPatterns[2]" must be a string`,
      `"workboxConfig.modifyURLPrefix./" must be a string`,
      `"workboxConfig.cacheId" must be a string`,
      `"workboxConfig.dontCacheBustURLsMatching" must be of type object`,
      `"workboxConfig.runtimeCaching[0].handler" must be one of [StaleWhileRevalidate, CacheFirst, NetworkFirst, NetworkOnly, CacheOnly]`,
      `"workboxConfig.runtimeCaching[1]" must be of type object`,
      `"workboxConfig.runtimeCaching[2]" must be of type object`,
      `"workboxConfig.skipWaiting" must be a boolean`,
      `"workboxConfig.clientsClaim" must be a boolean`,
    ]

    const { isValid, errors } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        precachePages: [1, 2, 3],
        appendScript: 1223,
        debug: `This should be a boolean`,
        workboxConfig: {
          importWorkboxFrom: 123,
          globDirectory: 456,
          globPatterns: [1, 2, 3],
          modifyURLPrefix: {
            "/": 123,
          },
          cacheId: 123,
          dontCacheBustURLsMatching: `This should be a regexp`,
          runtimeCaching: [
            {
              urlPattern: /(\.js$|\.css$|static\/)/,
              handler: `Something Invalid`,
            },
            2,
            3,
          ],
          skipWaiting: `This should be a boolean`,
          clientsClaim: `This should be a boolean`,
        },
      }
    )

    expect(isValid).toBe(false)
    expect(errors).toEqual(expectedErrors)
  })

  it(`should validate the schema`, async () => {
    const { isValid, errors } = await testPluginOptionsSchema(
      pluginOptionsSchema,
      {
        precachePages: [`/about-us/`, `/projects/*`],
        appendScript: `src/custom-sw-code.js`,
        debug: true,
        workboxConfig: {
          importWorkboxFrom: `local`,
          globDirectory: `rootDir`,
          globPatterns: [`a`, `b`, `c`],
          modifyURLPrefix: {
            "/": `pathPrefix/`,
          },
          cacheId: `gatsby-plugin-offline`,
          dontCacheBustURLsMatching: /(\.js$|\.css$|static\/)/,
          maximumFileSizeToCacheInBytes: 4800,
          runtimeCaching: [
            {
              urlPattern: /(\.js$|\.css$|static\/)/,
              handler: `CacheFirst`,
            },
            {
              urlPattern: /^https?:.*\/page-data\/.*\.json/,
              handler: `StaleWhileRevalidate`,
            },
            {
              urlPattern:
                /^https?:.*\.(png|jpg|jpeg|webp|svg|gif|tiff|js|woff|woff2|json|css)$/,
              handler: `StaleWhileRevalidate`,
            },
            {
              urlPattern: /^https?:\/\/fonts\.googleapis\.com\/css/,
              handler: `StaleWhileRevalidate`,
            },
          ],
          skipWaiting: true,
          clientsClaim: true,
        },
      }
    )

    expect(isValid).toBe(true)
    expect(errors).toEqual([])
  })
})
