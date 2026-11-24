import { fromPromise, PromiseActorLogic } from "xstate"

// xstate 4 のサービスは、マシンのコンテキストを引数に受け取る関数だった。
// xstate 5 のアクターは `input` しか受け取らないので、invoke の `input` にコンテキストを渡し、
// これまでのサービスの関数をそのまま使えるようにする。

/**
 * コンテキストを受け取るサービスの関数を、xstate 5 の Promise のアクターにする。
 * invoke する側は `input: contextAsInput` を指定する。
 */
export const fromService = <TContext, TOutput>(
  service: (context: TContext) => Promise<TOutput> | TOutput
): PromiseActorLogic<TOutput, TContext> =>
  fromPromise(async ({ input }) => service(input))

export const contextAsInput = <TContext>({
  context,
}: {
  context: TContext
}): TContext => context
