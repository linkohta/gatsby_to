#!/usr/bin/env node

/*
これは主に開発用だが、以前のフルビルドが、アーキテクチャやプラットフォームの異なる
環境へのデプロイ用に行われていた場合に、ローカルのプラットフォームとアーキテクチャ向けに
エンジンだけを再生成する目的でも使える。

開発用としては、`gatsby build` を一度実行してデータを取得し、スキーマを出力した後に、
ソースファイルの変更を反映して graphql-engine だけを再バンドルし、
再ビルドしたエンジンをすばやくテストするために使う

使い方:
このスクリプトを使い始める前に、`gatsby build` が少なくとも
一度成功している必要がある（データストアを準備し、
"page-ssr" バンドルを生成するため）。それが済んだら、
サイトのディレクトリで次のコマンドを実行できる:

```shell
node node_modules/gatsby/dist/schema/graphql-engine/standalone-regenerate.js
```
*/

import { createGraphqlEngineBundle } from "./bundle-webpack"
import { createPageSSRBundle } from "./../../utils/page-ssr-module/bundle-webpack"
import reporter from "gatsby-cli/lib/reporter"
import { loadConfigAndPlugins } from "../../utils/worker/child/load-config-and-plugins"
import * as fs from "fs-extra"
import { store } from "../../redux"
import { validateEnginesWithActivity } from "../../utils/validate-engines"

async function run(): Promise<void> {
  process.env.GATSBY_SLICES = `1`
  // config を読み込む
  reporter.verbose(`loading config and plugins`)
  await loadConfigAndPlugins({
    siteDirectory: process.cwd(),
  })

  try {
    reporter.verbose(`clearing webpack cache`)
    // キャッシュが存在すれば取り除く
    await fs.remove(process.cwd() + `/.cache/webpack/query-engine`)
    await fs.remove(process.cwd() + `/.cache/webpack/page-ssr`)
  } catch (e) {
    // eslint-disable no-empty
  }

  const state = store.getState()

  // 再コンパイルする
  const buildActivityTimer = reporter.activityTimer(
    `(Re)Building Rendering Engines`
  )
  try {
    buildActivityTimer.start()
    await Promise.all([
      createGraphqlEngineBundle(process.cwd(), reporter, true),
      createPageSSRBundle({
        rootDir: process.cwd(),
        components: store.getState().components,
        staticQueriesByTemplate: state.staticQueriesByTemplate,
        webpackCompilationHash: state.webpackCompilationHash, // webpackCompilationHash は上で設定している
        reporter,
        isVerbose: state.program.verbose,
      }),
    ])
  } catch (err) {
    buildActivityTimer.panic(err)
  } finally {
    buildActivityTimer.end()
  }

  await validateEnginesWithActivity(process.cwd())

  reporter.info(`Rebuilding Rendering Engines finished`)
}

run()
