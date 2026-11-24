import { match as reachMatch } from "@gatsbyjs/reach-router"
import { parseCookie } from "cookie"
import { urlencoded, text, json, raw } from "express"
import type { RequestHandler, Request, Response, NextFunction } from "express"
import reporter from "gatsby-cli/lib/reporter"
import multer from "multer"

import {
  createConfig,
  IGatsbyFunctionConfigProcessed,
  IGatsbyBodyParserConfigProcessed,
  IAPIFunctionWarning,
} from "./config"
import type { IGatsbyFunction } from "../../redux/types"

const expressBuiltinMiddleware = {
  urlencoded,
  text,
  json,
  raw,
}

interface IGatsbyRequestContext {
  functionObj: IGatsbyFunction
  fnToExecute: (req: Request, res: Response) => void | Promise<void>
  // params は setContext ミドルウェアの早い段階で加工しているが、どうやら他のミドルウェアが
  // リセットしてしまうようなので、自前のコンテキストに保存しておき、後で復元する
  params: Request[`params`]
  config: IGatsbyFunctionConfigProcessed
  showDebugMessageInResponse: boolean
}

interface IGatsbyInternalRequest extends Request {
  context?: IGatsbyRequestContext
}

type IGatsbyMiddleware = (
  req: IGatsbyInternalRequest,
  res: Response,
  next: NextFunction
) => Promise<void> | void

interface ICreateMiddlewareConfig {
  getFunctions: () => Array<IGatsbyFunction>
  prepareFn?: (functionObj: IGatsbyFunction) => Promise<void> | void
  showDebugMessageInResponse?: boolean
}

export function printConfigWarnings(
  warnings: Array<IAPIFunctionWarning>,
  functionObj: IGatsbyFunction
): void {
  if (warnings.length) {
    for (const warning of warnings) {
      reporter.warn(
        `${
          warning.property
            ? `\`${warning.property}\` property of exported config`
            : `Exported config`
        } in \`${
          functionObj.originalRelativeFilePath
        }\` is misconfigured.\nExpected object:\n\n${
          warning.expectedType
        }\n\nGot:\n\n${JSON.stringify(
          warning.original
        )}\n\nUsing default:\n\n${JSON.stringify(
          warning.replacedWith,
          null,
          2
        )}`
      )
    }
  }
}

function createSetContextFunctionMiddleware({
  getFunctions,
  prepareFn,
  showDebugMessageInResponse,
}: ICreateMiddlewareConfig): IGatsbyMiddleware {
  return async function executeFunction(
    req: IGatsbyInternalRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const functions = getFunctions()
    const { "0": pathFragment } = req.params

    // 最初に完全一致を確認する。
    let functionObj = functions.find(
      ({ functionRoute }) => functionRoute === pathFragment
    )

    if (!functionObj) {
      // 一致する matchPath があるかを確認する。
      // 最初の一致が見つかるまでループする。
      functions.some(f => {
        if (f.matchPath) {
          const matchResult = reachMatch(f.matchPath, pathFragment)
          if (matchResult) {
            req.params = matchResult.params
            if (req.params[`*`]) {
              // v3 との後方互換性のため
              // TODO v5 で削除する
              req.params[`0`] = req.params[`*`]
            }
            functionObj = f

            return true
          }
        }

        return false
      })
    }

    if (functionObj) {
      let userConfig
      if (prepareFn) {
        await prepareFn(functionObj)
      }

      const pathToFunction = functionObj.absoluteCompiledFilePath
      let fnToExecute
      try {
        delete require.cache[require.resolve(pathToFunction)]
        const fn = require(pathToFunction)
        userConfig = fn?.config

        fnToExecute = (fn && fn.default) || fn
      } catch (e) {
        if (e?.message?.includes(`fnToExecute is not a function`)) {
          e.message = `${functionObj.originalAbsoluteFilePath} does not export a function.`
        }

        fnToExecute = undefined
        reporter.error(e)
        if (!res.headersSent) {
          if (showDebugMessageInResponse) {
            res
              .status(500)
              .send(
                `Error when executing function "${functionObj.originalAbsoluteFilePath}":<br /><br />${e.message}`
              )
          } else {
            res.sendStatus(500)
          }
        }
        return
      }

      if (fnToExecute) {
        const { config, warnings } = createConfig(userConfig)

        printConfigWarnings(warnings, functionObj)

        req.context = {
          functionObj,
          fnToExecute,
          params: req.params,
          config,
          showDebugMessageInResponse: showDebugMessageInResponse ?? false,
        }
      }
    }

    next()
  }
}

function setCookies(
  req: IGatsbyInternalRequest,
  _res: Response,
  next: NextFunction
): void {
  const cookies = req.headers.cookie

  if (!cookies) {
    return next()
  }

  req.cookies = parseCookie(cookies)

  return next()
}

function bodyParserMiddlewareWithConfig(
  type: keyof IGatsbyBodyParserConfigProcessed
): IGatsbyMiddleware {
  return function (
    req: IGatsbyInternalRequest,
    res: Response,
    next: NextFunction
  ): void {
    if (req.context && req.context.config.bodyParser) {
      const bodyParserConfig = req.context.config.bodyParser[type]
      expressBuiltinMiddleware[type](bodyParserConfig)(req, res, next)
    } else {
      next()
    }
  }
}

async function executeFunction(
  req: IGatsbyInternalRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.context) {
    reporter.verbose(`Running ${req.context.functionObj.functionRoute}`)
    req.params = req.context.params
    const start = Date.now()
    const context = req.context
    // 内部のコンテキストを実際のリクエストハンドラーに漏らしたくない
    delete req.context
    try {
      await Promise.resolve(context.fnToExecute(req, res))
    } catch (e) {
      if (e?.message?.includes(`fnToExecute is not a function`)) {
        e.message = `${context.functionObj.originalAbsoluteFilePath} does not export a function.`
      }

      reporter.error(e)
      // エラーを送ることで別のエラーが起きる場合は送らない。
      if (!res.headersSent) {
        if (context.showDebugMessageInResponse) {
          res
            .status(500)
            .send(
              `Error when executing function "${context.functionObj.originalAbsoluteFilePath}":<br /><br />${e.message}`
            )
        } else {
          res.sendStatus(500)
        }
      }
    }

    const end = Date.now()
    reporter.log(
      `Executed function "/api/${context.functionObj.functionRoute}" in ${
        end - start
      }ms`
    )
  } else {
    next()
  }
}

export function functionMiddlewares(
  middlewareConfig: ICreateMiddlewareConfig
): Array<RequestHandler> {
  const setContext = createSetContextFunctionMiddleware(middlewareConfig)

  return [
    setCookies,
    setContext,
    multer().any(),
    bodyParserMiddlewareWithConfig(`raw`),
    bodyParserMiddlewareWithConfig(`text`),
    bodyParserMiddlewareWithConfig(`urlencoded`),
    bodyParserMiddlewareWithConfig(`json`),
    executeFunction,
  ]
}
