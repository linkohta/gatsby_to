import convertHrtime from "convert-hrtime"

// convert-hrtime 4 以降は `process.hrtime()` の `[秒, ナノ秒]` ではなく、
// ナノ秒の bigint を受け取る
export function elapsedNanoseconds(startTime?: [number, number]): bigint {
  const [seconds, nanoseconds] = process.hrtime(startTime)

  return BigInt(seconds) * BigInt(1e9) + BigInt(nanoseconds)
}

export function calcElapsedTime(startTime: [number, number]): string {
  return convertHrtime(elapsedNanoseconds(startTime))[`seconds`].toFixed(3)
}
