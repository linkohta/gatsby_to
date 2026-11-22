import { initTracer, JaegerTracer, TracingConfig } from "jaeger-client"

let tracer: JaegerTracer

function create(): JaegerTracer {
  // スキーマは次を参照
  // https://github.com/jaegertracing/jaeger-client-node/blob/master/src/configuration.js#L37
  const config: TracingConfig = {
    serviceName: `gatsby`,
    reporter: {
      // トレースのエンドポイントを指定する。これにより、クライアントは
      // Collector に直接接続し、スパンを HTTP で送る
      collectorEndpoint: `http://localhost:14268/api/traces`,
    },
    sampler: {
      type: `const`,
      param: 1,
    },
  }
  const options = {}
  tracer = initTracer(config, options)
  return tracer
}

function stop(): Promise<void> {
  return new Promise(resolve => {
    tracer.close(resolve)
  })
}

export { create, stop }
