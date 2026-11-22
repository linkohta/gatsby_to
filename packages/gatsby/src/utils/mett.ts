// これは mitt.js を基にした単純なイベントエミッターである
// 主な違いは、データモデルを、通常のオブジェクトと配列ではなく
// Map と Set を使うように変えていることである。

type MettHandler<EventName, Payload> = (
  e: Payload,
  eventName: EventName
) => void

export interface IMett {
  on(eventName: EventName, callback: MettHandler<EventName, Payload>): void
  off(eventName: EventName, callback: MettHandler<EventName, Payload>): void
  emit(eventName: EventName, e?: Payload): void
}

type EventName = string
type Payload = any

export function mett(): IMett {
  const mettEvents: Map<
    EventName,
    Set<MettHandler<EventName, Payload>>
  > = new Map()

  return {
    on(eventName: EventName, callback: MettHandler<EventName, Payload>): void {
      const set = mettEvents.get(eventName)
      if (set) {
        set.add(callback)
      } else {
        mettEvents.set(eventName, new Set([callback]))
      }
    },
    off(eventName: EventName, callback: MettHandler<EventName, Payload>): void {
      const set = mettEvents.get(eventName)
      if (set) {
        set.delete(callback)
      }
    },
    emit(eventName: EventName, e: Payload): void {
      const setName = mettEvents.get(eventName)
      if (setName) {
        setName.forEach(function mettEmitEachC(callback) {
          callback(e, eventName)
        })
      }
      const setStar = mettEvents.get(`*`)
      if (setStar) {
        setStar.forEach(function mettEmitEachStar(callback) {
          callback(e, eventName)
        })
      }
    },
  }
}
