import * as path from "path"
import * as fs from "fs-extra"

// Windows で url にバックスラッシュが入らないように、posix 形式の join を強制したい
const { join } = path.posix

export interface IScriptsAndStyles {
  scripts: Array<any>
  styles: Array<any>
  reversedStyles: Array<any>
  reversedScripts: Array<any>
}

interface IChunk {
  name: string
  rel: string
  content?: string
  shouldGenerateLink?: boolean
}

const inlineCssPromiseCache = new Map<string, Promise<string>>()

export async function readWebpackStats(publicDir: string): Promise<any> {
  const filePath = join(publicDir, `webpack.stats.json`)
  const rawPageData = await fs.readFile(filePath, `utf-8`)

  return JSON.parse(rawPageData)
}

export async function getScriptsAndStylesForTemplate(
  componentChunkName,
  webpackStats
): Promise<IScriptsAndStyles> {
  const uniqScripts = new Map<string, IChunk>()
  const uniqStyles = new Map<string, IChunk>()

  /**
   * script または style を正しいグループに追加する。それらが一意であること（重複がないこと）と、"preload" が他のどの "rel" よりも優先されることを保証する
   */
  function handleAsset(
    name: string,
    rel: string,
    shouldGenerateLink: boolean = false
  ): void {
    let uniqueAssetsMap: Map<string, IChunk> | undefined

    // アセットの種類に応じて正しいマップを選ぶ
    if (name.endsWith(`.js`)) {
      uniqueAssetsMap = uniqScripts
    } else if (name.endsWith(`.css`)) {
      uniqueAssetsMap = uniqStyles
    }

    if (uniqueAssetsMap) {
      const existingAsset = uniqueAssetsMap.get(name)

      if (
        existingAsset &&
        rel === `preload` &&
        existingAsset.rel !== `preload`
      ) {
        // このアセットをすでに追跡しているが preload ではない場合は、preload にする。
        // preload のほうが優先度が高いためである
        existingAsset.rel = `preload`
      } else if (!existingAsset) {
        uniqueAssetsMap.set(name, { name, rel, shouldGenerateLink })
      }
    }
  }

  // webpack.stats.json を使って、テンプレートが使っている script と style を集める
  for (const chunkName of [`app`, componentChunkName]) {
    let assets = webpackStats.assetsByChunkName[chunkName]

    if (!assets) {
      continue
    }

    // テンプレート用の JS アセットを取り除く
    if (chunkName !== `app`) {
      assets = assets.filter(asset => !asset.endsWith(`.js`))
    }

    for (const asset of assets) {
      if (asset === `/`) {
        continue
      }

      handleAsset(asset, `preload`)
    }

    // webpack のマジックコメントの処理。たとえば:
    // import(/* webpackChunkName: "<chunk_name>", webpackPrefetch: true */ `<path_to_module>`)
    // webpackStats.childAssetsByChunkName の形:
    // {
    //   childAssetsByChunkName: {
    //     <name_of_top_level_chunk>: {
    //       prefetch: [
    //         "<chunk_name>-<chunk_hash>.js",
    //       ]
    //     }
    //   }
    // }

    const childAssets = webpackStats.childAssetsByChunkName[chunkName]
    if (!childAssets) {
      continue
    }

    for (let [rel, assets] of Object.entries(childAssets)) {
      // テンプレート用の JS アセットを取り除く（マジックコメント）
      if (chunkName !== `app`) {
        // @ts-ignore TS doesn't like that assets is not typed and especially that it doesn't know that it's Iterable
        assets = assets.filter(asset => !asset.endsWith(`.js`))
      }

      // @ts-ignore TS doesn't like that assets is not typed and especially that it doesn't know that it's Iterable
      for (const asset of assets) {
        // shouldGenerateLink を使って、マジックコメントのアセット（preload|prefetch）の link を head に追加すべきかを判定する
        const shouldGenerateLink = chunkName == `app` ? true : false
        handleAsset(asset, rel, shouldGenerateLink)
      }
    }
  }

  // scripts 配列を作成する。"preload" の script が優先されるようにする
  const scripts: Array<IChunk> = []
  for (const scriptAsset of uniqScripts.values()) {
    if (scriptAsset.rel === `preload`) {
      // preload を優先する
      scripts.unshift(scriptAsset)
    } else {
      scripts.push(scriptAsset)
    }
  }

  // styles 配列を作成する。"preload" の style が優先されるようにし、prefetch 以外の "rel" についてはインライン化のために .css の内容を読み込む
  const styles: Array<IChunk> = []
  for (const styleAsset of uniqStyles.values()) {
    if (styleAsset.rel !== `prefetch`) {
      let getInlineCssPromise = inlineCssPromiseCache.get(styleAsset.name)
      if (!getInlineCssPromise) {
        getInlineCssPromise = fs.readFile(
          join(process.cwd(), `public`, styleAsset.name),
          `utf-8`
        )

        inlineCssPromiseCache.set(
          styleAsset.name,
          getInlineCssPromise as Promise<string>
        )
      }

      styleAsset.content = await getInlineCssPromise
    }

    if (styleAsset.rel === `preload`) {
      // preload を優先する
      styles.unshift(styleAsset)
    } else {
      styles.push(styleAsset)
    }
  }

  return {
    scripts,
    styles,
    reversedStyles: styles.slice(0).reverse(),
    reversedScripts: scripts.slice(0).reverse(),
  }
}

export function clearCache(): void {}
