process.env.GATSBY_SHOULD_TRACK_IMAGE_CDN_URLS = "true"

// See https://github.com/inrupt/solid-client-authn-js/issues/1676
if (
  typeof globalThis.TextEncoder === "undefined" ||
  typeof globalThis.TextDecoder === "undefined"
) {
  const utils = require("util")
  globalThis.TextEncoder = utils.TextEncoder
  globalThis.TextDecoder = utils.TextDecoder
}

// React 19 の react-dom/server（ブラウザ向けビルド）は読み込み時に MessageChannel を
// 使うが、jsdom には存在しない。Node.js の実装（worker_threads）はポートが開いている間
// プロセスの終了を妨げるので、メッセージを非同期に渡すだけの最小限の代替を用意する
if (typeof globalThis.MessageChannel === "undefined") {
  globalThis.MessageChannel = class MessageChannel {
    constructor() {
      const createPort = () => {
        const port = {
          onmessage: null,
          other: null,
          postMessage(data) {
            setTimeout(() => {
              if (port.other.onmessage) {
                port.other.onmessage({ data })
              }
            }, 0)
          },
        }
        return port
      }
      this.port1 = createPort()
      this.port2 = createPort()
      this.port1.other = this.port2
      this.port2.other = this.port1
    }
  }
}

jest.mock(`gatsby-worker`, () => {
  const gatsbyWorker = jest.requireActual(`gatsby-worker`)

  const { WorkerPool: OriginalWorkerPool } = gatsbyWorker

  class WorkerPoolThatCanUseTS extends OriginalWorkerPool {
    constructor(workerPath, options) {
      options.env = {
        ...(options.env ?? {}),
        NODE_OPTIONS: `--require ${require.resolve(
          `./packages/gatsby/src/utils/worker/__tests__/test-helpers/ts-register.js`
        )}`,
      }
      super(workerPath, options)
    }
  }

  return {
    ...gatsbyWorker,
    WorkerPool: WorkerPoolThatCanUseTS,
  }
})
