import { collectedScriptsByPage } from "gatsby-script"
import { injectPartytownSnippet } from "./utils/inject-partytown-snippet"
import type { GatsbyBrowser } from "gatsby"

// off-main-thread のスクリプトが `gatsby develop` で読み込まれるようにする
export const onInitialClientRender: GatsbyBrowser[`onInitialClientRender`] =
  (): void => {
    if (process.env.NODE_ENV !== `development`) {
      return
    }

    injectPartytownSnippet(collectedScriptsByPage.get(window.location.pathname))

    // 状態が漏れないように、使い終わったスクリプトを消去する
    collectedScriptsByPage.delete(window.location.pathname)
  }

// クライアントサイドのナビゲーション（CSR。Gatsby Link によるナビゲーションなど）は、Partytown 本体の側で壊れている。
// 再設定とオンデマンドのスクリプト読み込みを扱うための公式 API が Partytown に必要である。
// それまでは、`off-main-thread` のスクリプトはサーバーサイドのナビゲーション（SSR）でだけ読み込まれる。
// 詳しくは https://github.com/BuilderIO/partytown/issues/74 を参照。
