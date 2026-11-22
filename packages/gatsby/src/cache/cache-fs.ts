// 最初のファイルは https://github.com/rolandstarke/node-cache-manager-fs-hash @ af52d2d から取得した
/* eslint-disable @babel/no-invalid-this, no-useless-catch */
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
const fs = require(`fs`)
const crypto = require(`crypto`)
const path = require(`path`)
const promisify = require(`util`).promisify
const jsonFileStore = require(`./json-file-store`)
const wrapCallback = require(`./wrap-callback`)

import reporter from "gatsby-cli/lib/reporter"

// キャッシュの読み書きは非同期である。このロックは競合状態を防ぐためのものである。
// 理想的な実装ではなく、ロックは 10 秒でタイムアウトする。この仕組みが fs ベースの
// ロックを使っていたころの実装を、ほぼそのまま移植したものである。メモリ上で行うことで IO の負荷が減る。
// また、現状では 2 つのビルドの同時実行には対応していない。
const globalGatsbyCacheLock = new Map()

let showLockTimeoutWarning = true // これは 1 回だけ表示する

/**
 * ディスクストアを構築する
 * @param {object} [args] ディスクストアのオプション
 * @param {string} [args.path] キャッシュファイルのパス
 * @param {number} [args.ttl] 有効期間（秒）
 * @param {boolean} [args.zip] ディスク容量を節約するために内容を zip 圧縮する
 * @todo {number} [args.maxsize] ディスク上の最大サイズ（バイト）
 * @param {boolean} [args.subdirs] サブディレクトリを作成する
 * @returns {DiskStore}
 */
exports.create = function (args): typeof DiskStore {
  return new DiskStore(args && args.options ? args.options : args)
}

function DiskStore(this: any, options): void {
  options = options || {}

  this.options = {
    path: options.path || `./cache` /* キャッシュファイルのパス  */,
    ttl:
      options.ttl >= 0
        ? +options.ttl
        : 60 * 60 /* 期限切れまでの時間（秒） */,
    maxsize: options.maxsize || Infinity /* ディスク上の最大サイズ（バイト） */,
    subdirs: options.subdirs || false,
    zip: options.zip || false,
    lockFile: {
      // 0ms、50ms、100ms ... 400ms、1400ms、1450ms... と最大 10 秒までロックを確認し、それを過ぎたらロックは古くなったものとみなす
      wait: 400,
      pollPeriod: 50,
      stale: 10 * 1000,
      retries: 10,
      retryWait: 600,
    },
  }

  // ストレージのディレクトリが存在するかを確認する（なければ作成する）
  if (!fs.existsSync(this.options.path)) {
    fs.mkdirSync(this.options.path)
  }
}

/**
 * ストアにエントリーを保存する
 * @param {string} key
 * @param {*} val
 * @param {object} [options]
 * @param {number} options.ttl 有効期間（秒）
 * @param {function} [cb]
 * @returns {Promise}
 */
DiskStore.prototype.set = wrapCallback(async function (
  this: any,
  key,
  val,
  options
) {
  key = key + ``
  const filePath = this._getFilePathByKey(key)

  const ttl = options && options.ttl >= 0 ? +options.ttl : this.options.ttl
  const data = {
    expireTime: Date.now() + ttl * 1000,
    key: key,
    val: val,
  }

  if (this.options.subdirs) {
    // サブディレクトリが存在するかを確認し、なければ作成する
    const dir = path.dirname(filePath)
    await promisify(fs.access)(dir, fs.constants.W_OK).catch(function () {
      return promisify(fs.mkdir)(dir).catch(err => {
        if (err.code !== `EEXIST`) throw err
      })
    })
  }

  try {
    await this._lock(filePath)
    await jsonFileStore.write(filePath, data, this.options)
  } catch (err) {
    throw err
  } finally {
    await this._unlock(filePath)
  }
})

/**
 * ストアからエントリーを取得する
 * @param {string} key
 * @param {function} [cb]
 * @returns {Promise}
 */
DiskStore.prototype.get = wrapCallback(async function (this: any, key) {
  key = key + ``
  const filePath = this._getFilePathByKey(key)

  try {
    const data = await jsonFileStore
      .read(filePath, this.options)
      .catch(async err => {
        if (err.code === `ENOENT`) {
          throw err
        }
        // ファイルが書き込み中かもしれないので、ロックしてから読み直す
        try {
          await this._lock(filePath)
          return await jsonFileStore.read(filePath, this.options)
        } catch (err2) {
          throw err2
        } finally {
          await this._unlock(filePath)
        }
      })
    if (data.expireTime <= Date.now()) {
      // キャッシュの期限切れ
      this.del(key).catch(() => 0 /* 無視する */)
      return undefined
    }
    if (data.key !== key) {
      // ハッシュの衝突
      return undefined
    }
    return data.val
  } catch (err) {
    // ファイルが存在しないので、キャッシュミスを返す
    if (err.code === `ENOENT`) {
      return undefined
    } else {
      throw err
    }
  }
})

/**
 * キャッシュからエントリーを削除する
 */
DiskStore.prototype.del = wrapCallback(async function (this: any, key) {
  const filePath = this._getFilePathByKey(key)
  try {
    if (this.options.subdirs) {
      // 早く失敗させるために、フォルダーが存在するかを確認する
      const dir = path.dirname(filePath)
      await promisify(fs.access)(dir, fs.constants.W_OK)
    }

    await this._lock(filePath)
    await jsonFileStore.delete(filePath, this.options)
  } catch (err) {
    // 存在しないキーの削除は無視する
    if (err.code !== `ENOENT`) {
      throw err
    }
  } finally {
    await this._unlock(filePath)
  }
})

/**
 * ディスク上のキャッシュを片付ける -> キャッシュからすべてのファイルを削除する
 */
DiskStore.prototype.reset = wrapCallback(async function (
  this: any
): Promise<void> {
  const readdir = promisify(fs.readdir)
  const stat = promisify(fs.stat)
  const unlink = promisify(fs.unlink)

  return await deletePath(this.options.path, 2)

  async function deletePath(fileOrDir, maxDeep): Promise<void> {
    if (maxDeep < 0) {
      return
    }
    const stats = await stat(fileOrDir)
    if (stats.isDirectory()) {
      const files = await readdir(fileOrDir)
      for (let i = 0; i < files.length; i++) {
        await deletePath(path.join(fileOrDir, files[i]), maxDeep - 1)
      }
    } else if (
      stats.isFile() &&
      /[/\\]diskstore-[0-9a-fA-F/\\]+(\.json|-\d\.bin)/.test(fileOrDir)
    ) {
      // ディスクストアのファイルであれば削除する
      await unlink(fileOrDir)
    }
  }
})

/**
 * ファイルをロックし、同じファイルを使いたい他のフォークが待つようにする
 * @param {string} filePath
 * @returns {Promise}
 * @private
 */
DiskStore.prototype._lock = function _lock(filePath): Promise<void> {
  return new Promise((resolve, reject) => innerLock(resolve, reject, filePath))
}

function innerLock(resolve, reject, filePath): void {
  try {
    let lockTime = globalGatsbyCacheLock.get(filePath) ?? 0
    if (lockTime > 0 && Date.now() - lockTime > 10 * 1000) {
      if (showLockTimeoutWarning) {
        showLockTimeoutWarning = false
        reporter.verbose(
          `Warning: lock file older than 10s, ignoring it... There is a possibility this leads to caching problems later. This warning will only be shown once.`
        )
      }
      lockTime = 0
      globalGatsbyCacheLock.delete(filePath)
    }

    if (lockTime > 0) {
      setTimeout(() => {
        innerLock(resolve, reject, filePath)
      }, 50)
    } else {
      // 同期的に設定する
      globalGatsbyCacheLock.set(filePath, Date.now())
      resolve()
    }
  } catch (e) {
    reject(e)
  }
}

/**
 * ファイルパスのロックを解除する
 * @type {Function}
 * @param {string} filePath
 * @returns {void}
 * @private
 */
DiskStore.prototype._unlock = function _unlock(filePath): void {
  globalGatsbyCacheLock.delete(filePath)
}

/**
 * 値を保存すべき場所を返す
 * @param {string} key
 * @returns {string}
 * @private
 */
DiskStore.prototype._getFilePathByKey = function (key): string {
  const hash = crypto
    .createHash(`md5`)
    .update(key + ``)
    .digest(`hex`)
  if (this.options.subdirs) {
    // ハッシュの先頭 3 文字でサブディレクトリを作成する
    return path.join(
      this.options.path,
      `diskstore-` + hash.slice(0, 3),
      hash.slice(3)
    )
  } else {
    return path.join(this.options.path, `diskstore-` + hash)
  }
}
