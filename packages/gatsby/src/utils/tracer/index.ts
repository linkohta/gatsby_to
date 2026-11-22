import { slash } from "gatsby-core-utils"
import path from "path"
import { Tracer, initGlobalTracer } from "opentracing"

interface ITracerProvider {
  create(): Tracer
  stop(): Promise<void>
}

let tracerProvider: ITracerProvider | undefined

/**
 * tracerFile は、2 つの関数を export する js ファイルであること。
 *
 * `create` - open-tracing 互換の tracer を作成して返す。次を参照
 * https://github.com/opentracing/opentracing-javascript/blob/master/src/tracer.ts
 *
 * `stop` - node.js のプロセスが終了する前に必要な tracer の後始末を
 * 実行する
 */
export const initTracer = async (tracerFile: string): Promise<Tracer> => {
  let tracer: Tracer
  if (tracerFile) {
    process.env.GATSBY_OPEN_TRACING_CONFIG_FILE = tracerFile
    const resolvedPath = slash(path.resolve(tracerFile))
    tracerProvider = require(resolvedPath)
    tracer = await tracerProvider!.create()
  } else {
    tracer = new Tracer() // Noop
  }

  initGlobalTracer(tracer)

  return tracer
}

export const stopTracer = async (): Promise<void> => {
  if (tracerProvider?.stop) {
    await tracerProvider.stop()
  }
}
