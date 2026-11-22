export default class Batcher<Callback extends (...args: Array<any>) => any> {
  private queue: Array<Parameters<Callback>> = []
  private callbacks: Array<(...args: Parameters<Callback>) => void> = []
  private bulkCallbacks: Array<(args: Array<Parameters<Callback>>) => void> = []

  constructor(private threshold: number) {}

  /** バッチャーに呼び出しを追加する */
  add(...args: Parameters<Callback>): void {
    this.queue.push(args)

    if (this.queue.length >= this.threshold) {
      this.flush()
    }
  }

  /** すべてのコールバックを呼び、キューを空にする */
  flush(): void {
    // キューの中のそれぞれの項目について、それぞれのコールバックを呼ぶ
    this.queue.forEach(args =>
      this.callbacks.forEach(callback => callback(...args))
    )

    // すべての一括コールバックにキュー全体を渡す
    this.bulkCallbacks.forEach(callback => {
      callback(this.queue)
    })

    // キューを空にする
    this.queue = []
  }

  /** バッチャーの項目ごとに呼ばれるコールバックを設定する */
  call(callback: (...args: Parameters<Callback>) => void): void {
    this.callbacks.push(callback)
  }

  /** キュー全体を受け取る一括コールバックを設定する */
  bulkCall(callback: (args: Array<Parameters<Callback>>) => void): void {
    this.bulkCallbacks.push(callback)
  }
}
