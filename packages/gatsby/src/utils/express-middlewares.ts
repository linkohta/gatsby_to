import type { TrailingSlash } from "gatsby-page-utils"
import express from "express"
import type { IGatsbyState } from "../redux/types"
import { findPageByPath } from "./find-page-by-path"

export const configureTrailingSlash =
  (getState: () => IGatsbyState, option: TrailingSlash | undefined) =>
  (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void => {
    const method = req.method.toLocaleLowerCase()
    if (![`get`, `head`].includes(method)) {
      next()
      return
    }

    if (req?.path.split(`/`)?.pop()?.includes(`.`)) {
      // パスに拡張子がある。スラッシュを追加しない。
      next()
      return
    }

    if (req.path.length <= 1) {
      next()
      return
    }

    // Gatsby のページであるかを確認する
    const page = findPageByPath(getState(), req.path)

    if (page) {
      if (option === `never`) {
        if (req.path.slice(-1) === `/` && page.path !== req.path) {
          // 末尾のスラッシュを取り除く
          const query = req.url.slice(req.path.length)
          res.redirect(301, req.path.slice(0, -1) + query)
          return
        } else {
          // express.static は、末尾にスラッシュがないパスを本当に嫌う
          // そのため、末尾にスラッシュがあるリクエストに見えるように、リクエストを「書き換える」
          // そうしないと、リダイレクトの無限ループになる。こうしているのは、
          // express.static が末尾のスラッシュへのリダイレクトを自動的に追加するためである
          const BASE = `http://localhost`
          const urlToMessWith = new URL(req.url, BASE)
          urlToMessWith.pathname += `/`

          // 受け取った req.url は相対的なので、base を再び取り除く
          // クエリやハッシュが自動的に処理されるように、new URL を使う
          req.url = urlToMessWith.toString().replace(BASE, ``)
        }
      } else if (option === `always`) {
        if (req.path.slice(-1) !== `/` && page.path !== req.path) {
          // 末尾のスラッシュを追加する
          const query = req.url.slice(req.path.length)
          res.redirect(301, `${req.path}/${query}`)
          return
        }
      }
    }

    next()
  }
