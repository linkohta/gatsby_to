// 大量のオブジェクトを反復処理するときに、イベントループをブロックしたくない
// このヘルパー関数は次の tick で解決される Promise を返す。ブロックするコードの実行を続ける前に、イベントループが先へ進めるようにするためである
export function untilNextEventLoopTick() {
  return new Promise(res => {
    setImmediate(() => {
      res(null)
    })
  })
}
