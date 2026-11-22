const { exec } = require(`child_process`)
const { createRequire } = require(`module`)

let sharpInstance: typeof import("sharp")

export = async function getSharpInstance(): Promise<typeof import("sharp")> {
  try {
    return importSharp()
  } catch (err) {
    await rebuildSharp()

    // sharp を再ビルドしたので、もう一度 import を試す
    return importSharp()
  }
}

function importSharp(): typeof import("sharp") {
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
