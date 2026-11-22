let intersectionObserver: IntersectionObserver

export type Unobserver = () => void

const ioEntryMap = new WeakMap<HTMLElement, () => void>()
/* eslint-disable @typescript-eslint/no-explicit-any  */
const connection =
  (navigator as any).connection ||
  (navigator as any).mozConnection ||
  (navigator as any).webkitConnection
/* eslint-enable @typescript-eslint/no-explicit-any */

// Chrome のネイティブの遅延読み込みで使われているしきい値に合わせている
// @see https://web.dev/browser-level-image-lazy-loading/#distance-from-viewport-thresholds
const FAST_CONNECTION_THRESHOLD = `1250px`
const SLOW_CONNECTION_THRESHOLD = `2500px`

export function createIntersectionObserver(
  callback: () => void
): (element: HTMLElement) => Unobserver {
  const connectionType = connection?.effectiveType

  // intersectionObserver に対応していない場合は遅延読み込みをしない（IE 11 には申し訳ない）。
  if (!(`IntersectionObserver` in window)) {
    return function observe(): Unobserver {
      callback()
      return function unobserve(): void {}
    }
  }

  if (!intersectionObserver) {
    intersectionObserver = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // 一致したエントリーのコールバックを取得して呼び出す
            ioEntryMap.get(entry.target as HTMLElement)?.()
            // 呼び出すのは 1 回だけでよい
            ioEntryMap.delete(entry.target as HTMLElement)
          }
        })
      },
      {
        rootMargin:
          connectionType === `4g` && !connection?.saveData
            ? FAST_CONNECTION_THRESHOLD
            : SLOW_CONNECTION_THRESHOLD,
      }
    )
  }

  return function observe(element: HTMLElement): Unobserver {
    // 監視対象の要素に対応付けて、コールバックへの参照を保存する
    ioEntryMap.set(element, callback)
    intersectionObserver.observe(element)

    return function unobserve(): void {
      if (intersectionObserver && element) {
        ioEntryMap.delete(element)
        intersectionObserver.unobserve(element)
      }
    }
  }
}
