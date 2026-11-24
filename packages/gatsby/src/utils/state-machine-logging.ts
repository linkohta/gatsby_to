import { AnyActorRef, StateValue } from "xstate"
import reporter from "gatsby-cli/lib/reporter"

// ステートマシンのアクターだけが `value`（現在の状態）を持つ。Promise やコールバックの
// アクターのスナップショットにはない
const getStateValue = (actor: AnyActorRef): StateValue | undefined =>
  actor.getSnapshot()?.value

const isSameState = (a: StateValue | undefined, b: StateValue): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

export function logTransitions(service: AnyActorRef): void {
  const listeners = new WeakSet<AnyActorRef>()
  let last: StateValue | undefined

  service.subscribe(state => {
    // コンテキストだけが変わったときは、状態の遷移ではないので出力しない
    if (state.value === undefined || isSameState(last, state.value)) {
      return
    }
    last = state.value
    if (process.env.gatsby_log_level === `verbose`) {
      reporter.verbose(`Transition to ${JSON.stringify(state.value)}`)
    }

    const children: Array<AnyActorRef> = Object.values(state.children ?? {})
    children.forEach(child => {
      // 同じアクターにリスナーを重複して付けないようにしたい。
      // リスナーの取り外しを気にする必要はない。アクターが停止したときに
      // xstate が処理してくれるためである。
      let sublast = getStateValue(child)
      if (sublast === undefined || listeners.has(child)) {
        return
      }
      child.subscribe(substate => {
        if (isSameState(sublast, substate.value)) {
          return
        }
        sublast = substate.value
        if (process.env.gatsby_log_level === `verbose`) {
          reporter.verbose(
            `Transition to ${JSON.stringify(state.value)} > ${JSON.stringify(
              substate.value
            )}`
          )
        }
      })
      listeners.add(child)
    })
  })
}
