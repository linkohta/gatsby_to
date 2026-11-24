import proxy from "express-http-proxy"
import type { RequestHandler } from "express"

export const thirdPartyProxyPath = `/__third-party-proxy`

export function partytownProxy(
  partytownProxiedURLs: Array<string>
): RequestHandler {
  // `@types/express-http-proxy` は express 4 の型を参照しているので、express 5 の型に読み替える
  const handler: unknown = proxy(
    req => new URL(req.query.url as string).origin as string,
    {
      filter: req => partytownProxiedURLs.some(url => req.query?.url === url),
      proxyReqPathResolver: req => {
        const { pathname = ``, search = `` } = new URL(req.query?.url as string)
        return pathname + search
      },
    }
  )

  return handler as RequestHandler
}
