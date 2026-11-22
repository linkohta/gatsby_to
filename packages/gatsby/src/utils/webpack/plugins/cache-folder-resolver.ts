import Resolver from "enhanced-resolve/lib/Resolver"
import mod from "module"

interface IRequest {
  request?: string
  path: string
}

type ProcessWithPNP = NodeJS.ProcessVersions & { pnp?: string }

/**
 * Yarn PnP と pnpm に対応するため、.cache フォルダーから解決される依存を
 * gatsby パッケージのディレクトリから解決されるようにする必要がある
 * 次のようなエラーが出た場合は、
 *
 * ModuleNotFoundError: Module not found: Error: Can't resolve 'prop-types'
 * in 'site-directory/.cache'
 *
 * このプラグインが有効であるべきなのに有効になっていない可能性が高く、
 * コンストラクターで `this.isEnabled` を設定する条件を調整する必要が
 * あるかもしれない。
 *
 * 常に有効にしていないのは、従来の挙動を保ち、リグレッションの可能性を
 * 抑えるためである。将来は常に有効にするのがよいかもしれない。
 * あるいは、`cache-dir` の内容を `.cache` フォルダーへコピーするのをやめ、
 * ブラウザーと Node の HTML レンダラーのランタイムファイルを gatsby パッケージから
 * 直接使う構成に変えて、このプラグイン自体を不要にする方法もある
 */
export class CacheFolderResolver {
  private requestsFolder: string
  private isEnabled = false

  constructor(requestsFolder: string) {
    this.requestsFolder = requestsFolder

    if ((process.versions as ProcessWithPNP).pnp) {
      // Yarn PnP
      this.isEnabled = true
    } else if (/node_modules[/\\]\.pnpm/.test(process.env.NODE_PATH ?? ``)) {
      // `pnpm` CLI 経由で実行したときの pnpm
      this.isEnabled = true
    } else {
      // 通常の `gatsby` CLI / `./node_modules/.bin/gatsby` 経由で実行したときの pnpm は
      // NODE_PATH を設定しないが、node_modules の構造上、キャッシュフォルダーからは
      // gatsby の依存を解決できない（ユーザーが同じ依存をインストールしていれば別である）
      // そのため、キャッシュフォルダーから依存を解決できるかどうかを確認している
      // この確認は pnpm に限ったものではなく、ほかのパッケージマネージャーでもこの経路を通ることがある

      // gatsby のブラウザーと SSR のランタイムで使う gatsby の依存をハードコードした一覧
      // Yarn PnP を使っているかどうかを（`process.versions.pnp` で）調べる代わりに、
      // 外部の依存を cache-dir フォルダーから解決できるかどうかを調べて、
      // このプラグインを有効にする必要があるかを判断する。これで pnpm にも対応できる
      // 全体としては常に有効にするのがよいかもしれないが、リグレッションの可能性を
      // 抑えるため、必要だと確信できる場合にだけ有効にしている。
      const modulesToCheck = [
        `prop-types`,
        `lodash/isEqual`,
        `mitt`,
        `shallow-compare`,
        `@gatsbyjs/reach-router`,
        `gatsby-react-router-scroll`,
        `react-server-dom-webpack`,
        `gatsby-link`,
      ]

      // キャッシュフォルダーから依存を解決できるかを試す
      let isEverythingResolvableFromCacheDir = true
      const cacheDirReq = mod.createRequire(requestsFolder)
      for (const cacheDirDep of modulesToCheck) {
        try {
          cacheDirReq.resolve(cacheDirDep)
        } catch {
          // キャッシュフォルダーから解決できないものがあるので、このプラグインは有効にしない
          isEverythingResolvableFromCacheDir = false
          break
        }
      }

      // gatsby パッケージから依存を解決できるかを試す
      let isEverythingResolvableFromGatsbyPackage = true
      for (const cacheDirDep of modulesToCheck) {
        try {
          require.resolve(cacheDirDep)
        } catch {
          // gatsby パッケージから解決できないものがある
          isEverythingResolvableFromGatsbyPackage = false
          break
        }
      }

      // このプラグインを有効にするのは、cache-dir の依存を .cache フォルダーから解決できず、
      // かつ gatsby パッケージからは解決できる場合だけである
      if (
        !isEverythingResolvableFromCacheDir &&
        isEverythingResolvableFromGatsbyPackage
      ) {
        this.isEnabled = true
      }
    }
  }

  apply(resolver: Resolver): void {
    if (!this.isEnabled) {
      return
    }

    const target = resolver.ensureHook(`raw-module`)
    resolver
      .getHook(`raw-module`)
      .tapAsync(
        `CacheFolderResolver`,
        (
          request: IRequest,
          resolveContext: unknown,
          callback: (err?: Error | null, result?: unknown) => void
        ) => {
          const req = request.request
          if (!req) {
            return callback()
          }

          if (!request.path.startsWith(this.requestsFolder)) {
            return callback()
          }

          const packageMatch = /^(@[^/]+\/)?[^/]+/.exec(req)
          if (!packageMatch) {
            return callback()
          }

          // issuer だけを変更し、ほかはそのままにして resolve をやり直す
          const obj = {
            ...request,
            path: __dirname,
          }

          return resolver.doResolve(
            target,
            obj,
            `change issuer to gatsby package by cache-folder-resolver to fix pnp`,
            resolveContext,
            callback
          )
        }
      )
  }
}
