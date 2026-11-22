import fastq from "fastq"
import fs from "fs-extra"

export function generatePrettyUrlFilePath(routePath: string): string {
  if (routePath.endsWith(`/`)) {
    return `${routePath}index.html`
  } else {
    return `${routePath}.html`
  }
}

interface IMoveTask {
  from: string
  to: string
  keepOriginalFile: boolean
}

export function normalizeDynamicRoutePath(routePath: string): string {
  return (
    routePath
      // `:param` を `[param]` に置き換える
      .replace(/:([^:/\\]+)/gm, `[$1]`)
      // `*param` を `[...param]` に、`*` を `[...]` に置き換える
      .replace(/\*([^:/\\]*)/gm, `[...$1]`)
  )
}

export function createStaticAssetsPathHandler(): {
  ensureStaticAssetPath: (
    filePath: string,
    routePath: string
  ) => { finalFilePath: string; isDynamic: boolean }
  fileMovingDone: () => Promise<void>
} {
  const moveQueue = fastq<void, IMoveTask, void>(async (task, cb) => {
    try {
      if (task.keepOriginalFile) {
        await fs.copy(task.from, task.to, { overwrite: true })
      } else {
        await fs.move(task.from, task.to, { overwrite: true })
      }
      cb(null, undefined)
    } catch (error) {
      cb(error)
    }
  }, 2)

  function ensureStaticAssetPath(
    filePath: string,
    routePath: string
  ): { finalFilePath: string; isDynamic: boolean } {
    const shouldUsePrettyUrl =
      filePath.endsWith(`.html`) && !routePath.endsWith(`.html`)

    let isDynamic = false
    // 動的ルートの構文は、多くのファイルシステムで予約されている文字を使う
    // そのため、ルートが動的な場合はファイルパスを正規化する
    if (routePath.includes(`/:`) || routePath.includes(`/*`)) {
      routePath = normalizeDynamicRoutePath(routePath)
      isDynamic = true
    }

    const finalFilePath = `public${
      shouldUsePrettyUrl ? generatePrettyUrlFilePath(routePath) : routePath
    }`

    if (finalFilePath !== filePath) {
      moveQueue.push({
        from: filePath,
        to: finalFilePath,
        // 404.html は、カスタム 404 ページとして使われるよう PUBLISH_DIR のルートに置いたままにする
        // 404.html と 500.html はどちらも、SSR/DSG 用に正しくバンドルされるよう PUBLISH_DIR のルートに置いたままにする
        keepOriginalFile:
          filePath === `public/404.html` || filePath === `public/500.html`,
      })
    }
    return {
      finalFilePath,
      isDynamic,
    }
  }

  const fileMovingDone = (): Promise<void> => {
    if (moveQueue.idle()) {
      return Promise.resolve()
    }
    return new Promise(resolve => {
      moveQueue.drain = resolve
    })
  }

  return {
    ensureStaticAssetPath,
    fileMovingDone,
  }
}
