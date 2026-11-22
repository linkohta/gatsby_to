import io from "socket.io-client"
import { reportError, clearError } from "./error-overlay-handler"
let socket = null

export default function socketIo() {
  if (process.env.NODE_ENV !== `production`) {
    if (!socket) {
      // まだ初期化していない場合は、WebSocket の初期化を試みる
      try {
        // トランスポートとして websocket を強制する
        socket = io({
          transports: [process.env.GATSBY_SOCKET_IO_DEFAULT_TRANSPORT],
        })

        // websocket が失敗した場合は、ポーリングを試す
        socket.on(`reconnect_attempt`, () => {
          socket.io.opts.transports = [`polling`, `websocket`]
        })

        socket.on(`message`, msg => {
          if (msg.type === `overlayError`) {
            if (msg.payload.message) {
              reportError(msg.payload.id, msg.payload.message)
            } else {
              clearError(msg.payload.id)
            }
            ___emitter.emit(msg.type, msg.payload)
          }
        })

        // develop プロセスの終了時などに、一部のブラウザーがコンソールへ
        // XHR の 'ERR_CONNECTION_REFUSED' エラーを大量に出力するのを防ぐ。
        socket.on(`disconnect`, () => {
          console.warn(`[socket.io] Disconnected from dev server.`)
        })
      } catch (err) {
        console.error(`Could not connect to socket.io on dev server.`)
      }
    }
    return socket
  } else {
    return null
  }
}

// 現在いる新しいパスを websocket-manager.js に伝える。
// これにより、バックエンドがこのパスのクエリを
// 優先できる。
function registerPath(path) {
  socket.emit(`registerPath`, path)
}

// 以前のパスの登録を解除する
function unregisterPath(path) {
  socket.emit(`unregisterPath`, path)
}

export { registerPath, unregisterPath }
