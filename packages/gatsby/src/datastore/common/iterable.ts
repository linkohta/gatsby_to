declare module "lmdb" {
  // 現在、lmdb にはこの export の型定義がない
  export function clearKeptObjects(): void
}

import { clearKeptObjects } from "lmdb"
/**
 * 任意のイテラブルのラッパー。配列に似た、チェーン可能なインターフェースと
 * 便利なメソッドを提供する。
 *
 * さらに、ソート済みのイテラブル向けの便利なメソッドも提供する。
 *
 * 注: パフォーマンス上の理由から非同期イテラブルは避けている。https://github.com/nodejs/node/issues/31979 を参照
 * （幸い、lmdb は同期的に非常に高速に走査できる）
 */
export class GatsbyIterable<T> {
  constructor(private source: Iterable<T> | (() => Iterable<T>)) {}

  *[Symbol.iterator](): Iterator<T> {
    const source =
      typeof this.source === `function` ? this.source() : this.source

    let i = 0
    for (const val of source) {
      yield val

      // clearKeptObjects は、現在の同期実行のティック中に何らかの形で使われた WeakRef を
      // ガベージコレクションの対象にできるようにするだけである。GC を強制するのではなく、
      // V8 内部の強参照を取り除く。
      // https://github.com/kriszyp/weak-lru-cache/issues/4 を参照
      if (++i % 100 === 0) {
        clearKeptObjects()
      }
    }
  }

  concat<U>(other: Iterable<U>): GatsbyIterable<T | U> {
    return new GatsbyIterable(() => concatSequence(this, other))
  }

  map<U>(fn: (entry: T, index: number) => U): GatsbyIterable<U> {
    return new GatsbyIterable(() => mapSequence(this, fn))
  }

  filter(predicate: (entry: T) => unknown): GatsbyIterable<T> {
    return new GatsbyIterable(() => filterSequence(this, predicate))
  }

  slice(start: number, end?: number): GatsbyIterable<T> {
    if ((typeof end !== `undefined` && end < start) || start < 0)
      throw new Error(
        `Both arguments must not be negative and end must be greater than start`
      )
    return new GatsbyIterable<T>(() => sliceSequence(this, start, end))
  }

  deduplicate(keyFn?: (entry: T) => unknown): GatsbyIterable<T> {
    return new GatsbyIterable<T>(() => deduplicateSequence(this, keyFn))
  }

  forEach(callback: (entry: T, index: number) => unknown): void {
    let i = 0
    for (const value of this) {
      callback(value, i++)
    }
  }

  /**
   * this ともう一方のイテラブルがどちらもソート済みであることを前提に、
   * 値を交互に織り込んだ新しいソート済みのイテラブルを生成する。
   *
   * 注: このメソッドは重複を取り除かない
   */
  mergeSorted<U = T>(
    other: Iterable<U>,
    comparator?: (a: T | U, b: T | U) => number
  ): GatsbyIterable<T | U> {
    return new GatsbyIterable(() => mergeSorted(this, other, comparator))
  }

  /**
   * this ともう一方のイテラブルがどちらもソート済みであることを前提に、
   * this のイテラブルの値のうち、もう一方のイテラブルにも存在するものからなる
   * 新しいソート済みのイテラブルを生成する。
   */
  intersectSorted<U = T>(
    other: Iterable<U>,
    comparator?: (a: T | U, b: T | U) => number
  ): GatsbyIterable<T | U> {
    return new GatsbyIterable(() => intersectSorted(this, other, comparator))
  }

  /**
   * このイテラブルがソート済みであることを前提に、隣り合う値に
   * comparator(prev, current) を適用して重複を取り除く。
   *
   * comparator 関数は、Array.prototype.sort() の引数と同じように、
   * 項目が等しいときに 0 を返すことが期待される。
   *
   * comparator が設定されていない場合は、厳密な === での比較を使う
   */
  deduplicateSorted(comparator?: (a: T, b: T) => number): GatsbyIterable<T> {
    return new GatsbyIterable<T>(() => deduplicateSorted(this, comparator))
  }
}

/**
 * 渡された値がイテラブルであれば true を返す
 */
export function isIterable(obj: unknown): obj is Iterable<any> {
  if (typeof obj !== `object` || obj === null) {
    return false
  }
  return typeof obj[Symbol.iterator] === `function`
}

export function isNonArrayIterable<T>(value: unknown): value is Iterable<T> {
  return isIterable(value) && !Array.isArray(value)
}

function* mapSequence<T, U>(
  source: Iterable<T>,
  fn: (arg: T, index: number) => U
): Generator<U> {
  let i = 0
  for (const value of source) {
    yield fn(value, i++)
  }
}

function* sliceSequence<T>(
  source: Iterable<T>,
  start: number,
  end: number | undefined
): Generator<T> {
  let index = -1
  for (const item of source) {
    index++
    if (index < start) continue
    if (typeof end !== `undefined` && index >= end) break
    yield item
  }
}

function* filterSequence<T>(
  source: Iterable<T>,
  predicate: (arg: T) => unknown
): Generator<T> {
  for (const value of source) {
    if (predicate(value)) {
      yield value
    }
  }
}

function* concatSequence<T, U>(
  first: Iterable<T>,
  second: Iterable<U>
): Generator<U | T> {
  for (const value of first) {
    yield value
  }
  for (const value of second) {
    yield value
  }
}

function* deduplicateSequence<T>(
  source: Iterable<T>,
  keyFn?: (entry: T) => unknown
): Generator<T> {
  // TODO: ブルームフィルターを使えば改善できるかもしれない
  const registered = new Set<unknown>()

  for (const current of source) {
    const key = keyFn ? keyFn(current) : current
    if (!registered.has(key)) {
      registered.add(key)
      yield current
    }
  }
}

function* deduplicateSorted<T>(
  source: Iterable<T>,
  comparator: (a: T, b: T) => number = defaultComparator
): Generator<T> {
  let prev
  for (const current of source) {
    if (typeof prev === `undefined` || comparator(prev, current) !== 0) {
      yield current
    }
    prev = current
  }
}

// もともとソート済みの 2 つのイテラブルをマージする:
function* mergeSorted<T, U = T>(
  firstSorted: Iterable<T>,
  secondSorted: Iterable<U>,
  comparator: (a: T | U, b: T | U) => number = defaultComparator
): Generator<T | U> {
  const iter1 = firstSorted[Symbol.iterator]()
  const iter2 = secondSorted[Symbol.iterator]()
  try {
    let a = iter1.next()
    let b = iter2.next()
    while (!a.done && !b.done) {
      if (comparator(a.value, b.value) <= 0) {
        yield a.value
        a = iter1.next()
      } else {
        yield b.value
        b = iter2.next()
      }
    }
    while (!a.done) {
      yield a.value
      a = iter1.next()
    }
    while (!b.done) {
      yield b.value
      b = iter2.next()
    }
  } finally {
    // ジェネレーターが途中で終了した場合は、イテレーターも必ず閉じる
    // https://raganwald.com/2017/07/22/closing-iterables-is-a-leaky-abstraction.html#more-about-closing-iterators-explicitly を参照
    if (typeof iter1.return === `function`) iter1.return()
    if (typeof iter2.return === `function`) iter2.return()
  }
}

function* intersectSorted<T, U = T>(
  firstSorted: Iterable<T>,
  secondSorted: Iterable<U>,
  comparator: (a: T | U, b: T | U) => number = defaultComparator
): Generator<T> {
  const iter1 = firstSorted[Symbol.iterator]()
  const iter2 = secondSorted[Symbol.iterator]()
  try {
    let a = iter1.next()
    let b = iter2.next()

    while (!a.done && !b.done) {
      const eq = comparator(a.value, b.value)

      if (eq < 0) {
        // a < b
        a = iter1.next()
      } else if (eq > 0) {
        // a > b
        b = iter2.next()
      } else {
        yield a.value
        a = iter1.next()
      }
    }
  } finally {
    if (typeof iter1.return === `function`) iter1.return()
    if (typeof iter2.return === `function`) iter2.return()
  }
}

function defaultComparator<T, U = T>(a: T | U, b: T | U): number {
  if (a === b) {
    return 0
  }
  return a > b ? 1 : -1
}
