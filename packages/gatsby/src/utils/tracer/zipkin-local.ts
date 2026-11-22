import zipkin from "zipkin"
import { HttpLogger } from "zipkin-transport-http"
import ZipkinTracer from "zipkin-javascript-opentracing"
import fetch from "node-fetch"
import { ZipkinBatchRecorder, ZipkinHttpLogger } from "./zipkin-types"

let logger: ZipkinHttpLogger
let recorder: ZipkinBatchRecorder

/**
 * open-tracing 互換の tracer を作成して返す。次を参照
 * https://github.com/opentracing/opentracing-javascript/blob/master/src/tracer.ts
 */
export const create = (): ZipkinTracer => {
  logger = new HttpLogger({
    // ローカルの docker の zipkin インスタンスのエンドポイント
    endpoint: `http://localhost:9411/api/v1/spans`,
  }) as ZipkinHttpLogger

  recorder = new zipkin.BatchRecorder({
    logger,
    // タイムアウト = 60 時間。サイトのビルド時間より長くなければならない
    timeout: 60 * 60 * 60 * 1000000,
  }) as ZipkinBatchRecorder

  const tracer = new ZipkinTracer({
    localServiceName: `gatsby`,
    serviceName: `gatsby`,
    // 1 個のスパンのうち 1 個をサンプリングする（100%）。本番の
    // サービスをトレースする場合は、トレースの情報がサイトのパフォーマンスに
    // 影響しないように、10 リクエストのうち 1 つをサンプリングするのが普通である。しかし
    // Gatsby はビルドツールであり、リクエストは "1" つ（ビルド）しか
    // ない。そのため、スパンが欠けないように、これを 100% に
    // 設定しなければならない
    sampler: new zipkin.sampler.CountingSampler(1),
    traceId128Bit: true,
    recorder,
    kind: `client`,
  })

  return tracer
}

// node.js のプロセスが終了する前に、スパンが処理キューから
// 消去されないという Zipkin HTTP Logger の問題への回避策。
// コードは、zipkin の processQueue の実装と
// ほぼ同じである。
const _processQueue = async (): Promise<void> => {
  if (logger.queue.length > 0) {
    const postBody = `[${logger.queue.join(`,`)}]`
    try {
      const response = await fetch(logger.endpoint, {
        method: `POST`,
        body: postBody,
        headers: logger.headers,
        timeout: logger.timeout,
      })

      if (response.status !== 202) {
        const err =
          `Unexpected response while sending Zipkin data, status:` +
          `${response.status}, body: ${postBody}`

        if (logger.errorListenerSet) logger.emit(`error`, new Error(err))
        else console.error(err)
      }
    } catch (error) {
      const err = `Error sending Zipkin data ${error}`
      if (logger.errorListenerSet) logger.emit(`error`, new Error(err))
      else console.error(err)
    }
  }
}

/**
 * node.js のプロセスが終了する前に必要な tracer の後始末を
 * 実行する。Zipkin HTTP の場合は、キューに残っているスパンを
 * 手動で処理しなければならない
 */
export const stop = async (): Promise<void> => {
  // まず、未完了のスパンをすべて http ロガーに書き込む
  recorder.partialSpans.forEach((span, id) => {
    if (recorder._timedOut(span)) {
      recorder._writeSpan(id)
    }
  })

  // 次に、キューの中のすべてのスパンを処理するよう http ロガーに伝える
  await _processQueue()
}
