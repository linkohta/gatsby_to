import fs from "fs-extra"
import type { IncomingMessage } from "http"
import type { Headers, Options } from "got"
import type { GatsbyCache } from "gatsby"

// 後方互換性のために I を残している
export type IFetchRemoteFileOptions = {
  url: string
  auth?: {
    htaccess_pass?: string
    htaccess_user?: string
  }
  httpHeaders?: Headers
  ext?: string
  name?: string
  cacheKey?: string
  excludeDigest?: boolean
} & (
  | {
      directory: string
      cache?: never
    }
  | {
      directory?: never
      cache: GatsbyCache
    }
)

const STALL_RETRY_LIMIT = process.env.GATSBY_STALL_RETRY_LIMIT
  ? parseInt(process.env.GATSBY_STALL_RETRY_LIMIT, 10)
  : 3
const STALL_TIMEOUT = process.env.GATSBY_STALL_TIMEOUT
  ? parseInt(process.env.GATSBY_STALL_TIMEOUT, 10)
  : 30000

const CONNECTION_TIMEOUT = process.env.GATSBY_CONNECTION_TIMEOUT
  ? parseInt(process.env.GATSBY_CONNECTION_TIMEOUT, 10)
  : 30000

const INCOMPLETE_RETRY_LIMIT = process.env.GATSBY_INCOMPLETE_RETRY_LIMIT
  ? parseInt(process.env.GATSBY_INCOMPLETE_RETRY_LIMIT, 10)
  : 3

// jest ではすべてのタイマーを無限に動かせないので、テストでは 0 にしている
const BACKOFF_TIME = process.env.NODE_ENV === `test` ? 0 : 1000

function range(start: number, end: number): Array<number> {
  return Array(end - start)
    .fill(null)
    .map((_, i) => start + i)
}

// https://github.com/JustinBeckwith/retry-axios のデフォルト値に基づく
const STATUS_CODES_TO_RETRY = [...range(100, 200), 429, ...range(500, 600)]
const ERROR_CODES_TO_RETRY = [
  `ETIMEDOUT`,
  `ECONNRESET`,
  `EADDRINUSE`,
  `ECONNREFUSED`,
  `EPIPE`,
  `ENOTFOUND`,
  `ENETUNREACH`,
  `EAI_AGAIN`,
  `ERR_NON_2XX_3XX_RESPONSE`,
  `ERR_GOT_REQUEST_ERROR`,
]

/**
 * requestRemoteNode
 * --
 * 要求されたファイルをダウンロードする
 *
 * @param  {String}   url
 * @param  {Headers}  headers
 * @param  {String}   tmpFilename
 * @param  {Object}   httpOptions
 * @param  {number}   attempt
 * @return {Promise<Object>}  [http Result Object]{@link https://nodejs.org/api/http.html#http_class_http_serverresponse} で解決される
 */
export async function requestRemoteNode(
  url: string | URL,
  headers: Headers,
  tmpFilename: string,
  httpOptions?: Options,
  attempt: number = 1
): Promise<IncomingMessage> {
  // TODO(v5): 動的 import の構文を使う。古い v4 のバージョンに V8-compile-cache があるため、現在はできない
  // const { default: got, RequestError } = await import(`got`)
  const { default: got, RequestError } = require(`got`)

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout
    const fsWriteStream = fs.createWriteStream(tmpFilename)
    fsWriteStream.on(`error`, (error: unknown) => {
      if (timeout) {
        clearTimeout(timeout)
      }

      reject(error)
    })

    // データを何も受信しないまま 30 秒間止まった場合に呼ばれる
    const handleTimeout = async (): Promise<void> => {
      fsWriteStream.close()
      await fs.remove(tmpFilename)

      if (attempt < STALL_RETRY_LIMIT) {
        // 自分自身を再帰的に呼び出してリトライする
        resolve(
          requestRemoteNode(url, headers, tmpFilename, httpOptions, attempt + 1)
        )
      } else {
        // TODO 新しい Error 型に移行する
        // eslint-disable-next-line prefer-promise-reject-errors
        reject(`Failed to download ${url} after ${STALL_RETRY_LIMIT} attempts`)
      }
    }

    const resetTimeout = (): void => {
      if (timeout) {
        clearTimeout(timeout)
      }
      timeout = setTimeout(handleTimeout, STALL_TIMEOUT)
    }
    const responseStream = got.stream(url, {
      headers,
      timeout: {
        send: CONNECTION_TIMEOUT, // https://github.com/sindresorhus/got#timeout
      },
      ...httpOptions,
      isStream: true,
    })

    let haveAllBytesBeenWritten = false
    // 最新の got にある、ストリームの終了時に（完了していなくても）progress.total がリセットされるバグを修正する。
    let totalSize: number | null = null
    responseStream.on(`downloadProgress`, progress => {
      // 大きなファイルがタイムアウトしないよう、progress イベントのたびにタイムアウトをリセットする
      resetTimeout()

      if (
        progress.total != null &&
        (!totalSize || totalSize < progress.total)
      ) {
        totalSize = progress.total
      }

      if (progress.transferred === totalSize || totalSize === null) {
        haveAllBytesBeenWritten = true
      }
    })

    responseStream.pipe(fsWriteStream)

    // 400/500 のレスポンスやその他のエラーがあった場合。
    // fsWriteStream で finish イベントが発生する
    responseStream.on(`error`, async error => {
      if (timeout) {
        clearTimeout(timeout)
      }

      fsWriteStream.close()
      await fs.remove(tmpFilename)

      if (!(error instanceof RequestError)) {
        return reject(error)
      }

      // これは、すべての got のインスタンスを v12 に更新できるまでのあいだ、
      // got のストリームのリトライ処理の代わりに使うものである
      // https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md
      // https://github.com/sindresorhus/got/blob/main/documentation/3-streams.md#retry
      const statusCode = error.response?.statusCode
      const errorCode = error.code || error.message // got は error.code を渡すが、msw/node はエラーコードをメッセージの中でしか返さない

      if (
        // HTTP ステータスコードのエラー
        (statusCode && STATUS_CODES_TO_RETRY.includes(statusCode)) ||
        // 一般的なネットワークエラー
        (errorCode && ERROR_CODES_TO_RETRY.includes(errorCode))
      ) {
        if (attempt < INCOMPLETE_RETRY_LIMIT) {
          setTimeout(() => {
            resolve(
              requestRemoteNode(
                url,
                headers,
                tmpFilename,
                httpOptions,
                attempt + 1
              )
            )
          }, BACKOFF_TIME * attempt)

          return undefined
        }
        // ユーザーに分かりやすいエラーを投げる
        error.message = [
          `Unable to fetch:`,
          url,
          `---`,
          `Reason: ${error.message}`,
          `---`,
        ].join(`\n`)

        // エラーオブジェクトとリクエストから、何が問題だったかの詳細を集める
        const details = Object.entries({
          attempt,
          method: error.options?.method,
          errorCode: error.code,
          responseStatusCode: error.response?.statusCode,
          responseStatusMessage: error.response?.statusMessage,
          requestHeaders: error.options?.headers,
          responseHeaders: error.response?.headers,
        })
          // 詳細をすっきりさせるため、undefined の値を取り除く
          .reduce((a, [k, v]) => (v === undefined ? a : ((a[k] = v), a)), {})

        if (Object.keys(details).length) {
          error.message = [
            error.message,
            `Fetch details:`,
            JSON.stringify(details, null, 2),
            `---`,
          ].join(`\n`)
        }
      }

      return reject(error)
    })

    responseStream.on(`response`, response => {
      resetTimeout()

      fsWriteStream.once(`finish`, async () => {
        if (timeout) {
          clearTimeout(timeout)
        }

        // ダウンロードが不完全である
        if (!haveAllBytesBeenWritten) {
          await fs.remove(tmpFilename)

          if (attempt < INCOMPLETE_RETRY_LIMIT) {
            // node がファイルを削除する時間を与える
            setImmediate(() =>
              resolve(
                requestRemoteNode(
                  url,
                  headers,
                  tmpFilename,
                  httpOptions,
                  attempt + 1
                )
              )
            )

            return undefined
          } else {
            // TODO 新しい Error 型に移行する
            // eslint-disable-next-line prefer-promise-reject-errors
            return reject(
              `Failed to download ${url} after ${INCOMPLETE_RETRY_LIMIT} attempts`
            )
          }
        }

        return resolve(response)
      })
    })
  })
}
