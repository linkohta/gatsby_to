// 最初のファイルは https://github.com/rolandstarke/node-cache-manager-fs-hash @ af52d2d から取得した
/* !
The MIT License (MIT)

Copyright (c) 2017 Roland Starke

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const promisify = require(`util`).promisify
const fs = require(`fs`)
const zlib = require(`zlib`)

interface IExternalBuffer {
  index: number
  buffer: Buffer
}

exports.write = async function (path, data, options): Promise<void> {
  const externalBuffers: Array<IExternalBuffer> = []
  let dataString = JSON.stringify(data, function replacerFunction(_k, value) {
    // Buffer は {data: [...], type: "Buffer"} にシリアライズされる
    if (
      value &&
      value.type === `Buffer` &&
      value.data &&
      value.data.length >=
        1024 /* 大きな Buffer だけを外部に保存する。小さなものはインライン化できる */
    ) {
      const buffer = Buffer.from(value.data)
      externalBuffers.push({
        index: externalBuffers.length,
        buffer: buffer,
      })
      return {
        type: `ExternalBuffer`,
        index: externalBuffers.length - 1,
        size: buffer.length,
      }
    } else if (value === Infinity || value === -Infinity) {
      return { type: `Infinity`, sign: Math.sign(value) }
    } else {
      return value
    }
  })

  let zipExtension = ``
  if (options.zip) {
    zipExtension = `.gz`
    dataString = await promisify(zlib.deflate)(dataString)
  }
  // メインの JSON ファイルを保存する
  await promisify(fs.writeFile)(
    path + `.json` + zipExtension,
    dataString,
    `utf8`
  )

  // 外部の Buffer を保存する
  await Promise.all(
    externalBuffers.map(async function (externalBuffer) {
      let buffer = externalBuffer.buffer
      if (options.zip) {
        buffer = await promisify(zlib.deflate)(buffer)
      }
      await promisify(fs.writeFile)(
        path + `-` + externalBuffer.index + `.bin` + zipExtension,
        buffer,
        `utf8`
      )
    })
  )
}

exports.read = async function (path, options): Promise<string> {
  let zipExtension = ``
  if (options.zip) {
    zipExtension = `.gz`
  }

  // メインの JSON ファイルを読み込む
  let dataString
  if (options.zip) {
    const compressedData = await promisify(fs.readFile)(
      path + `.json` + zipExtension
    )
    dataString = (await promisify(zlib.unzip)(compressedData)).toString()
  } else {
    dataString = await promisify(fs.readFile)(
      path + `.json` + zipExtension,
      `utf8`
    )
  }

  const externalBuffers: Array<IExternalBuffer> = []
  let data
  try {
    data = JSON.parse(dataString, function bufferReceiver(_k, value) {
      if (value && value.type === `Buffer` && value.data) {
        return Buffer.from(value.data)
      } else if (
        value &&
        value.type === `ExternalBuffer` &&
        typeof value.index === `number` &&
        typeof value.size === `number`
      ) {
        // JSON.parse は同期的なので、Buffer を同期的に返す必要がある。中身は後で埋める
        const buffer = Buffer.alloc(value.size)
        externalBuffers.push({
          index: +value.index,
          buffer: buffer,
        })
        return buffer
      } else if (
        value &&
        value.type === `Infinity` &&
        typeof value.sign === `number`
      ) {
        return Infinity * value.sign
      } else {
        return value
      }
    })
  } catch (e) {
    throw new Error(
      "json-file-store failed to JSON.parse this string: `" +
        dataString.replace(/\n/g, `⏎`)
    )
  }

  // 外部の Buffer を読み込む
  await Promise.all(
    externalBuffers.map(async function (externalBuffer) {
      if (options.zip) {
        const bufferCompressed = await promisify(fs.readFile)(
          path + `-` + +externalBuffer.index + `.bin` + zipExtension
        )
        const buffer = await promisify(zlib.unzip)(bufferCompressed)
        buffer.copy(externalBuffer.buffer)
      } else {
        const fd = await promisify(fs.open)(
          path + `-` + +externalBuffer.index + `.bin` + zipExtension,
          `r`
        )
        await promisify(fs.read)(
          fd,
          externalBuffer.buffer,
          0,
          externalBuffer.buffer.length,
          0
        )
        await promisify(fs.close)(fd)
      }
    })
  )
  return data
}

exports.delete = async function (path, options): Promise<void> {
  let zipExtension = ``
  if (options.zip) {
    zipExtension = `.gz`
  }

  await promisify(fs.unlink)(path + `.json` + zipExtension)

  // バイナリファイルを削除する
  try {
    for (let i = 0; i < Infinity; i++) {
      await promisify(fs.unlink)(path + `-` + i + `.bin` + zipExtension)
    }
  } catch (err) {
    if (err.code === `ENOENT`) {
      // すべてのバイナリを削除したので完了
    } else {
      throw err
    }
  }
}
