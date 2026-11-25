import Resolver from "enhanced-resolve/lib/Resolver"
import path from "path"

// core-js は es6、es7、web の接頭辞を使っているので、core-js 3 のものへ変換する
const coreJs2FileRegex = /\/modules\/(es6|es7|web)\.|\/es6\/|\/es7\//

// ファイルサイズを減らすため、core-js2 のファイルを core-js@3 のものへ置き換えられるか試す
const replaceMap = [
  [`/es6.`, `/es.`],
  [`/es7.`, `/es.`],
  [`/es6/`, `/es/`],
  [`/es7/`, `/es/`],
  [`/es7/`, `/es/`],
  [`web.dom.iterable`, `web.dom-collections.iterator.js`],
  [`typed.data-view`, `data-view`],
  [`regexp.match`, `string.match`],
  [`regexp.replace`, `string.replace`],
  [`regexp.search`, `string.search`],
  [`regexp.split`, `string.split`],
]

interface IRequest {
  request?: string
  path: string
}

/**
 * Babel-preset は corejs@3 に設定されており、ポリフィルを自動で追加する。プロジェクトのルートに core-js@2 がインストールされている場合や、パッケージが core-js@2 でコンパイルされている場合は、
 * corejs@3 へ変換する必要がある。core-js@2 が利用できない、または同じ問題に対してポリフィルを複数追加してしまうおそれがあるためである。
 *
 * このリゾルバーは、バンドルをできるだけ小さくするために core-js@2 の import を core-js@3 の import へ変換する。
 */
export class CoreJSResolver {
  declare _coreJSNodeModulesPath: string

  constructor() {
    // gatsby の core-js が置かれている node_modules ディレクトリを取得する
    // 複数のバージョンの core-js が読み込まれている場合は gatsby/node_modules の中にあることがある
    this._coreJSNodeModulesPath = path.dirname(
      path.dirname(require.resolve(`core-js`))
    )
  }

  apply(resolver: Resolver): void {
    const target = resolver.ensureHook(`resolve`)
    const coreJsModulePath = this._coreJSNodeModulesPath

    function resolve(
      request: IRequest,
      resolveContext: unknown,
      callback: (err?: Error | null, result?: unknown) => void
    ): void {
      const innerRequest = request.request || request.path

      // 対象は core-js だけである
      if (!innerRequest || !innerRequest.startsWith(`core-js/`)) {
        return void callback()
      }

      let coreJsRequest = innerRequest
      let resolveMessage = `alias core-js@3 to gatsby's core-js package`

      // preset-env は modules/ からパッケージを追加するので、それを gatsby パッケージのものへ書き換える
      if (coreJs2FileRegex.test(coreJsRequest)) {
        replaceMap.forEach(([search, replace]) => {
          coreJsRequest = coreJsRequest.replace(search, replace)
        })

        resolveMessage = `map core-js@2(${innerRequest}) to corejs@3(${coreJsRequest})`
      }

      return void resolver.doResolve(
        target,
        {
          ...request,
          request: path.resolve(coreJsModulePath, coreJsRequest),
        },
        resolveMessage,
        resolveContext,
        (err, result) => {
          if (err) {
            return callback(err)
          }

          // 名前の置き換えに失敗した場合は、元のファイルの読み込みを試す
          // マッピングに漏れがあるとここでエラーになる可能性がある。いくつかのサイトで試した限りでは
          // 何も見つからなかったが、絶対とは言い切れない。
          if (result === undefined) {
            return callback()
          }

          return callback(null, result)
        }
      )
    }

    resolver.getHook(`described-resolve`).tapAsync(`CoreJSResolver`, resolve)
    resolver.getHook(`file`).tapAsync(`CoreJSResolver`, resolve)
  }
}
