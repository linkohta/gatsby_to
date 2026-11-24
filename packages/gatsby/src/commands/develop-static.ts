import sysPath from "path"
import express from "express"
import { ServeStaticOptions } from "serve-static"
import parseUrl from "parseurl"

export function developStatic(
  root: string,
  options: ServeStaticOptions
): express.Handler {
  // express 5（serve-static 2）は、既定で名前が `.` で始まるフォルダーの中のファイルも配信しなく
  // なった（`.well-known/` など）。express 4 の既定は「`.` で始まるファイルは配信しないが、
  // `.` で始まるフォルダーの中のファイルは配信する」だったので、同じ動作になるようにしている
  const expressStatic = express.static(root, { dotfiles: `allow`, ...options })

  return function (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): typeof expressStatic | void {
    if ([`GET`, `HEAD`].includes(req.method)) {
      const path = parseUrl(req).pathname
      const parsedPath = sysPath.parse(path)
      if ([`.htm`, `.html`].includes(parsedPath.ext)) {
        return next()
      }
      if (parsedPath.base.startsWith(`.`)) {
        return next()
      }
    }

    return expressStatic(req, res, next)
  }
}
