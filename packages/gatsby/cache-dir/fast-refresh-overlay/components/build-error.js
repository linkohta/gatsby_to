import * as React from "react"
import { Overlay, Header, Body, Footer, HeaderOpenClose } from "./overlay"
import { CodeFrame } from "./code-frame"
import { prettifyStack, openInEditor } from "../utils"

// webpack のエラーなどで投げられるエラー。閉じることはできず、修正する必要がある
export function BuildError({ error }) {
  // 渡されてくるビルドエラーは次のような形をしている:
  // "Enter" が入ることがある
  // ./relative-path-to-file
  // 追加情報（空行のこともある => "prettifyStack" 関数で処理する）
  // /absolute-path-to-file
  // エラーや警告
  const decoded = prettifyStack(error)
  const [filePath] = decoded
  const file = filePath.content.split(`\n`)[0]
  const lineMatch = filePath.content.match(/\((\d+)[^)]+\)/)
  let line = 1

  if (lineMatch) {
    line = lineMatch[1]
  }

  return (
    <Overlay>
      <Header data-gatsby-error-type="build-error">
        <div data-gatsby-overlay="header__cause-file">
          <h1 id="gatsby-overlay-labelledby">Failed to compile</h1>
          <span>{file}</span>
        </div>
        <HeaderOpenClose
          open={() => openInEditor(file, line)}
          dismiss={false}
        />
      </Header>
      <Body>
        <h2>Source</h2>
        <CodeFrame decoded={decoded} />
        <Footer id="gatsby-overlay-describedby">
          This error occurred during the build process and can only be dismissed
          by fixing the error.
        </Footer>
      </Body>
    </Overlay>
  )
}
