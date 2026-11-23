import mod from "module"
import * as path from "path"

// @ts-ignore TS doesn't like accessing `_load`
const originalModuleLoad = mod._load

class EngineValidationError extends Error {
  request: string
  relativeToRoot: string
  parentPath: string

  constructor({
    request,
    relativeToRoot,
    parent,
  }: {
    request: string
    relativeToRoot: string
    parent: mod
  }) {
    super(
      `Generated engines use disallowed import "${request}". Only allowed imports are to Node.js builtin modules or engines internals.`
    )
    this.request = request
    this.relativeToRoot = relativeToRoot
    this.parentPath = parent.filename
  }
}

export async function validate(directory: string): Promise<void> {
  // モジュールの読み込みに割り込み、予期しない import が起きていないことを検証する
  // @ts-ignore TS doesn't like accessing `_load`
  mod._load = (request: string, parent: mod, isMain: boolean): any => {
    // node の組み込みモジュールはすべて許可する
    if (mod.builtinModules.includes(request)) {
      return originalModuleLoad(request, parent, isMain)
    }

    // engines ディレクトリの中のモジュールの import を許可する。
    // たとえば、page-ssr エンジンからの ".cache/page-ssr/routes/render-page" の import は、
    // エンジンの一部なので許可すべきである。
    const allowedPrefixes = [
      path.join(`.cache`, `query-engine`),
      path.join(`.cache`, `page-ssr`),
    ]
    const localRequire = mod.createRequire(parent.filename)
    const absPath = localRequire.resolve(request)
    const relativeToRoot = path.relative(directory, absPath)
    for (const allowedPrefix of allowedPrefixes) {
      if (relativeToRoot.startsWith(allowedPrefix)) {
        return originalModuleLoad(request, parent, isMain)
      }
    }

    // 許可されていないものには、すべて例外を投げる
    // ランタイムがそれを try/catch して動作を続けることもある
    // （たとえば`msgpackr` は、ネイティブの `msgpack-extract` を読み込めない場合のフォールバックを持っている）
    // そのような場合は、投げたエラーが処理されるので、検証を失敗させない。
    // フォールバックがない場合は、検証を失敗させたい
    throw new EngineValidationError({ request, relativeToRoot, parent })
  }

  // gatsby-worker の問題への回避策:
  // gatsby-worker はエンジンにバンドルされ、環境変数 GATSBY_WORKER_MODULE_PATH が
  // 設定されていると "child" モジュールを自動的に初期化する。これを防ぐために、
  // 環境変数の設定を解除して falsy にする。
  process.env.GATSBY_WORKER_MODULE_PATH = ``

  // エンジンを import して初期化する。エラーが投げられた場合は、親プロセスで処理される
  const { GraphQLEngine } = require(
    path.join(directory, `.cache`, `query-engine`)
  )
  require(path.join(directory, `.cache`, `page-ssr`))
  const graphqlEngine = new GraphQLEngine({
    dbPath: path.join(directory, `.cache`, `data`, `datastore`),
  })
  await graphqlEngine.ready()
}
