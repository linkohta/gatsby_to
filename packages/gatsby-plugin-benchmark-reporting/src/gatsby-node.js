const { performance } = require(`perf_hooks`)

const { sync: glob } = require(`fast-glob`)
// node-fetch 3 以降は ESM 専用で、`require()` では default export が `default` に入る
const { default: nodeFetch } = require(`node-fetch`)
const { uuid } = require(`gatsby-core-utils`)
const { execSync } = require(`child_process`)
const fs = require(`fs`)

const bootstrapTime = performance.now()

const CI_NAME = process.env.CI_NAME

const BENCHMARK_REPORTING_URL =
  process.env.BENCHMARK_REPORTING_URL === `cli`
    ? undefined
    : process.env.BENCHMARK_REPORTING_URL

// このプラグインのすべてのイベントが `api` を受け取るわけではないため、最後に受け取ったものを保持する
let lastApi
// 現在のベンチマークの状態（あれば）。なければ次のライフサイクルで作成する。
let benchMeta

let nextBuildType = process.env.BENCHMARK_BUILD_TYPE ?? `initial`

function reportInfo(...args) {
  ;(lastApi ? lastApi.reporter : console).info(...args)
}
function reportError(...args) {
  ;(lastApi ? lastApi.reporter : console).error(...args)
}

function execToStr(cmd) {
  return String(
    execSync(cmd, {
      encoding: `utf8`,
    }) ?? ``
  ).trim()
}
function execToInt(cmd) {
  // `parseInt` は想定外の引数に対して `NaN` を返すことがある
  // `Number` は想定外の引数に対して undefined を返すことがある
  // `0 | x`（ビット OR）は、想定外の引数に対して必ず 0 を返し、それ以外は 32 ビット整数を返す
  return execToStr(cmd) | 0
}

class BenchMeta {
  constructor() {
    this.flushing = undefined // フラッシュが始まっていれば、その Promise
    this.flushed = false // フラッシュが完了したか
    this.localTime = new Date().toISOString()
    this.timestamps = {
      // TODO: node のタイミングデータにもアクセスして、このスクリプトの起動までにかかった時間を確認できるようにしたい
      bootstrapTime, // このファイルの開始時刻
      instantiationTime: performance.now(), // このクラスのインスタンス化の時刻
      benchmarkStart: 0, // ベンチマーク自体の開始時刻
      preInit: 0, // Gatsby の onPreInit ライフサイクル
      preBootstrap: 0, // Gatsby の onPreBootstrap ライフサイクル
      preBuild: 0, // Gatsby の onPreBuild ライフサイクル
      postBuild: 0, // Gatsby の onPostBuild ライフサイクル
      benchmarkEnd: 0, // ベンチマーク自体の終了時刻
    }
    this.started = false
  }

  getMetadata() {
    let siteId = ``
    try {
      // tags は json 文字列のはずだが、そうでない場合や不正な json 文字列である場合に備えて try/catch している
      siteId =
        JSON.parse(process.env?.GATSBY_TELEMETRY_TAGS ?? `{}`)?.siteId ?? `` // サーバーが設定する
    } catch (e) {
      siteId = `error`
      reportInfo(
        `Suppressed an error trying to JSON.parse(GATSBY_TELEMETRY_TAGS): ${e}`
      )
    }

    /**
     * netlify で実行している場合は、INCOMING_HOOK_BODY で環境変数を渡せる
     * そこから設定を取り出す
     */

    let buildType = nextBuildType
    nextBuildType = process.env.BENCHMARK_BUILD_TYPE_NEXT ?? `DATA_UPDATE`
    const incomingHookBodyEnv = process.env.INCOMING_HOOK_BODY

    if (CI_NAME === `netlify` && incomingHookBodyEnv) {
      try {
        const incomingHookBody = JSON.parse(incomingHookBodyEnv)
        buildType = incomingHookBody && incomingHookBody.buildType
      } catch (e) {
        reportInfo(
          `Suppressed an error trying to JSON.parse(INCOMING_HOOK_BODY): ${e}`
        )
      }
    }

    return {
      buildId: process.env.BENCHMARK_BUILD_ID,
      branch: process.env.BENCHMARK_BRANCH,
      siteId,
      contentSource: process.env.BENCHMARK_CONTENT_SOURCE,
      siteType: process.env.BENCHMARK_SITE_TYPE,
      repoName: process.env.BENCHMARK_REPO_NAME,
      buildType: buildType,
    }
  }

  getData() {
    // まずメモリ使用量のスナップショットを取得する（念のため）
    const { rss, heapTotal, heapUsed, external } = process.memoryUsage()
    const memory = {
      rss: rss ?? 0,
      heapTotal: heapTotal ?? 0,
      heapUsed: heapUsed ?? 0,
      external: external ?? 0,
    }

    for (const key in this.timestamps) {
      this.timestamps[key] = Math.floor(this.timestamps[key])
    }

    // 当面、対象のベンチマークはメインのリポジトリに含まれている
    // そのため、テストに使っているリポジトリのバージョンを知りたい
    // このリポジトリの外のサイトを実行する場合は、意図どおりに動作しない（！）
    const gitHash = execToStr(`git rev-parse HEAD`)
    // Git は環境変数経由でしか UTC のタイムゾーンを指定できないが、unix タイムスタンプは UTC である
    const unixStamp = execToStr(`git show --quiet --date=unix --format="%cd"`)
    const commitTime = new Date(parseInt(unixStamp, 10) * 1000).toISOString()

    const nodejsVersion = process.version

    // ベンチマークがグローバルインストールではなく、`node_modules/.bin/gatsby` から明示的に起動されることを前提にしている
    // （`gatsby --version` も最終的には同じことをしている）
    const gatsbyCliVersion = execToStr(`node_modules/.bin/gatsby --version`)

    const gatsbyVersion = require(`gatsby/package.json`).version

    const sharpVersion = fs.existsSync(`node_modules/sharp/package.json`)
      ? require(`sharp/package.json`).version
      : `none`

    const webpackVersion = require(`webpack/package.json`).version

    const publicJsSize = glob(`public/*.js`).reduce(
      (t, file) => t + fs.statSync(file).size,
      0
    )

    const jpgCount = execToInt(
      `find public .cache  -type f -iname "*.jpg" -or -iname "*.jpeg" | wc -l`
    )

    const pngCount = execToInt(
      `find public .cache  -type f -iname "*.png" | wc -l`
    )

    const gifCount = execToInt(
      `find public .cache  -type f -iname "*.gif" | wc -l`
    )

    const otherCount = execToInt(
      `find public .cache  -type f -iname "*.bmp" -or -iname "*.tif" -or -iname "*.webp" -or -iname "*.svg" | wc -l`
    )

    const benchmarkMetadata = this.getMetadata()

    return {
      time: this.localTime,
      sessionId: process.gatsbyTelemetrySessionId || uuid.v4(),
      cwd: process.cwd() ?? ``,
      timestamps: this.timestamps,
      gitHash,
      commitTime,
      ci: process.env.CI || false,
      ciName: CI_NAME || `local`,
      versions: {
        nodejs: nodejsVersion,
        gatsby: gatsbyVersion,
        gatsbyCli: gatsbyCliVersion,
        sharp: sharpVersion,
        webpack: webpackVersion,
      },
      counts: {
        pages: parseInt(process.env.NUM_PAGES),
        jpgs: jpgCount,
        pngs: pngCount,
        gifs: gifCount,
        other: otherCount,
      },
      memory,
      publicJsSize,
      ...benchmarkMetadata,
    }
  }

  markStart() {
    if (this.started) {
      reportError(
        `gatsby-plugin-benchmark-reporting: `,
        new Error(`Error: Should not call markStart() more than once`)
      )
      process.exit(1)
    }
    this.timestamps.benchmarkStart = performance.now()
    this.started = true
  }

  markDataPoint(name) {
    if (BENCHMARK_REPORTING_URL) {
      if (!(name in this.timestamps)) {
        reportError(
          `Attempted to record a timestamp with a name (\`${name}\`) that wasn't expected`
        )
        process.exit(1)
      }
    }
    this.timestamps[name] = performance.now()
  }

  async markEnd() {
    if (!this.timestamps.benchmarkStart) {
      reportError(
        `gatsby-plugin-benchmark-reporting:`,
        new Error(`Error: Should not call markEnd() before calling markStart()`)
      )
      process.exit(1)
    }
    this.timestamps.benchmarkEnd = performance.now()
    return this.flush()
  }

  async flush() {
    const data = this.getData()
    const json = JSON.stringify(data, null, 2)

    if (!BENCHMARK_REPORTING_URL) {
      reportInfo(`Gathered data: ` + json)
      reportInfo(`BENCHMARK_REPORTING_URL not set, not submitting data`)

      this.flushed = true
      return (this.flushing = Promise.resolve())
    }

    reportInfo(`Gathered data: ` + json)
    reportInfo(`Flushing benchmark data to remote server...`)

    let lastStatus = 0
    this.flushing = nodeFetch(`${BENCHMARK_REPORTING_URL}`, {
      method: `POST`,
      headers: {
        "content-type": `application/json`,
        "x-benchmark-secret": process.env.BENCHMARK_REPORTING_SECRET,
      },
      body: json,
    }).then(res => {
      lastStatus = res.status
      if ([401, 500].includes(lastStatus)) {
        reportInfo(`Got ${lastStatus} response, waiting for text`)
        res.text().then(content => {
          reportError(
            `Response error`,
            new Error(`Server responded with a ${lastStatus} error: ${content}`)
          )
          process.exit(1)
        })
      }
      this.flushed = true
      // Note: res.text は promise を返す
      return res.text()
    })

    this.flushing.then(text =>
      reportInfo(`Server response: ${lastStatus}: ${text}`)
    )

    return this.flushing
  }
}

function init(lifecycle) {
  if (!benchMeta) {
    benchMeta = new BenchMeta()
    // このプラグインを有効にするとき、サイトの gatsby-config で設定しておく必要がある
    reportInfo(
      `gatsby-plugin-benchmark-reporting: Will post benchmark data to: ${
        BENCHMARK_REPORTING_URL || `the CLI`
      }`
    )

    benchMeta.markStart()
  }
}

process.on(`exit`, () => {
  if (benchMeta && !benchMeta.flushed && BENCHMARK_REPORTING_URL) {
    // おそらくすでにゼロ以外の終了コードになっている。そうでなければ、node は最後の promise の完了を待つはずである
    reportError(
      `gatsby-plugin-benchmark-reporting error`,
      new Error(
        `This is process.exit(); Benchmark plugin has not completely flushed yet`
      )
    )
    process.exit(1)
  }
})

async function onPreInit(api) {
  lastApi = api
  init(`preInit`)
  benchMeta.markDataPoint(`preInit`)
}

async function onPreBootstrap(api) {
  lastApi = api
  init(`preBootstrap`)
  benchMeta.markDataPoint(`preBootstrap`)
}

async function onPreBuild(api) {
  lastApi = api
  init(`preBuild`)
  benchMeta.markDataPoint(`preBuild`)
}

async function onPostBuild(api) {
  if (!benchMeta) {
    // 無視する。このイベントでは計測を始めない。
    return
  }

  lastApi = api

  benchMeta.markDataPoint(`postBuild`)
  await benchMeta.markEnd()

  benchMeta = undefined
}

module.exports = { onPreInit, onPreBootstrap, onPreBuild, onPostBuild }
