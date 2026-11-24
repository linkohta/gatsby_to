import type sharp from "sharp"

const { exec } = require(`child_process`)
const { createRequire } = require(`module`)

// sharp 0.35 の型定義は、解決のされ方によって ESM の形（関数が `default` に入る）にも
// CommonJS の形（`export =`）にもなる。どちらでも sharp の関数そのものの型になるように、
// default import の型を使う
type SharpModule = typeof sharp

let sharpInstance: SharpModule

export = async function getSharpInstance(): Promise<SharpModule> {
  try {
    return importSharp()
  } catch (err) {
    await rebuildSharp()

    // sharp を再ビルドしたので、もう一度 import を試す
    return importSharp()
  }
}

function importSharp(): SharpModule {
  if (!sharpInstance) {
    const cleanRequire = createRequire(__filename)
    const sharp = cleanRequire(`sharp`)

    sharp.simd(true)
    // 並行処理は gatsby が制御する
    sharp.concurrency(1)

    sharpInstance = sharp
  }

  return sharpInstance
}

function rebuildSharp(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `npm rebuild sharp`,
      {
        timeout: 60 * 1000,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            console.log(`timeout reached`)
          }

          return reject(stderr)
        }

        return setImmediate(() => resolve(stdout))
      }
    )
  })
}
