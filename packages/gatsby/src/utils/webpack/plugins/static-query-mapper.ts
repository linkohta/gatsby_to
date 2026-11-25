import path from "path"
import { Store } from "redux"
import { Compiler, NormalModule } from "webpack"
import { isEqual, cloneDeep } from "lodash"
import { enqueueFlush } from "../../page-data"
import type { IGatsbyState, IGatsbyPageComponent } from "../../../redux/types"
import {
  ICollectedSlices,
  mergePreviouslyCollectedSlices,
} from "../../babel/find-slices"
import { slash } from "gatsby-core-utils/path"

/**
 * パスから export クエリパラメーターを取り除く。パスには次の 2 通りがある
 * a) ?export= クエリパラメーターだけを含む
 * b) ?__contentFilePath&export= も含む
 */
export const removeExportQueryParam = (
  path: string | undefined
): string | undefined => {
  if (!path?.includes(`?`)) {
    return path
  }
  const [filePath, queryParams] = path.split(`?`)
  const params = new URLSearchParams(queryParams.replace(/[+]/g, `%2B`))
  params.delete(`export`)

  const paramsString = params.toString().replace(/[+]/g, `%20`)

  return `${filePath}${
    paramsString ? `?${decodeURIComponent(paramsString)}` : ``
  }`
}

/**
 * モジュールが resourcePath に一致するかを調べる
 */
function doesModuleMatchResourcePath(
  resourcePath: string,
  webpackModule: NormalModule
): boolean {
  return (
    removeExportQueryParam((webpackModule as NormalModule).resource) ===
    resourcePath
  )
}

/**
 * パスの解決結果を設定、取得するためのヘルパー
 */
function getRealPath(
  cache: Map<string, string>,
  componentPath: string
): string {
  if (!cache.has(componentPath)) {
    cache.set(componentPath, path.resolve(componentPath))
  }

  return cache.get(componentPath) as string
}

export class StaticQueryMapper {
  declare private store: Store<IGatsbyState>
  declare private name: string

  constructor(store) {
    this.store = store
    this.name = `StaticQueryMapper`
  }

  apply(compiler: Compiler): void {
    const {
      components,
      staticQueryComponents,
      componentsUsingSlices,
      program,
    } = this.store.getState()

    compiler.hooks.done.tap(this.name, stats => {
      // 開発モードでは、コンパイルが成功したときに page-data を書き出したい
      if (!stats.hasErrors() && compiler.watchMode) {
        enqueueFlush()
      }
    })

    compiler.hooks.finishMake.tapPromise(
      {
        name: this.name,
        before: `PartialHydrationPlugin`,
      },
      async compilation => {
        if (compilation.compiler.parentCompilation) {
          return
        }

        const entryModules = new Set()
        const gatsbyBrowserPlugins = slash(
          path.join(
            program.directory,
            `.cache`,
            `api-runner-browser-plugins.js`
          )
        )
        const asyncRequiresPath = slash(
          path.join(
            program.directory,
            `.cache`,
            `_this_is_virtual_fs_path_`,
            `$virtual`,
            `async-requires.js`
          )
        )
        for (const entry of compilation.entries.values()) {
          for (const dependency of entry.dependencies) {
            const mod = compilation.moduleGraph.getModule(dependency)
            entryModules.add(mod)
          }
        }

        const realPathCache = new Map<string, string>()

        const webpackModulesByStaticQueryId = new Map<
          string,
          Set<NormalModule>
        >()
        const webpackModulesByUsedSlicePlaceholderAlias = new Map<
          NormalModule,
          ICollectedSlices
        >()
        const componentModules = new Map<NormalModule, IGatsbyPageComponent>()
        let asyncRequiresModule: NormalModule | undefined

        for (const webpackModule of compilation.modules) {
          if (!(webpackModule instanceof NormalModule)) {
            // この段階でほかにあり得る型は CssModule だけで、それは対象外である
            // これは型ガードも兼ねており、webpackModule の型がより詳しくなる
            continue
          }

          if (doesModuleMatchResourcePath(asyncRequiresPath, webpackModule)) {
            asyncRequiresModule = webpackModule
            continue
          }

          if (
            doesModuleMatchResourcePath(gatsbyBrowserPlugins, webpackModule)
          ) {
            entryModules.add(webpackModule)
            continue
          }

          for (const staticQuery of staticQueryComponents.values()) {
            const staticQueryComponentPath = getRealPath(
              realPathCache,
              staticQuery.componentPath
            )

            if (
              !doesModuleMatchResourcePath(
                staticQueryComponentPath,
                webpackModule
              )
            ) {
              continue
            }

            let set = webpackModulesByStaticQueryId.get(staticQuery.hash)

            if (!set) {
              set = new Set()
              webpackModulesByStaticQueryId.set(staticQuery.hash, set)
            }

            set.add(webpackModule)
          }

          for (const [filePath, slices] of componentsUsingSlices) {
            const componentComponentPath = getRealPath(realPathCache, filePath)

            if (
              !doesModuleMatchResourcePath(
                componentComponentPath,
                webpackModule
              )
            ) {
              continue
            }

            webpackModulesByUsedSlicePlaceholderAlias.set(webpackModule, slices)
          }

          for (const component of components.values()) {
            const componentComponentPath = getRealPath(
              realPathCache,
              component.componentPath
            )

            if (
              !doesModuleMatchResourcePath(
                componentComponentPath,
                webpackModule
              )
            ) {
              continue
            }

            componentModules.set(webpackModule, component)
          }
        }

        function traverseModule(
          module: NormalModule,
          config: {
            onComponent(component: IGatsbyPageComponent): void
            onRoot(): void
          },
          visitedModules = new Set<NormalModule>()
        ): void {
          if (visitedModules.has(module)) {
            return
          }
          visitedModules.add(module)

          if (module === asyncRequiresModule) {
            return
          }

          const component = componentModules.get(module)
          if (component) {
            config.onComponent(component)
            // ここではまだ return しない。コンポーネントが別のコンポーネントから import されている可能性があり、async-requires に届くまで上へたどりたいためである
          }

          if (entryModules.has(module)) {
            config.onRoot()
            return
          }

          const incomingConnections =
            compilation.moduleGraph.getIncomingConnections(module)
          for (const connection of incomingConnections) {
            if (connection.originModule instanceof NormalModule) {
              traverseModule(connection.originModule, config, visitedModules)
            }
          }
        }

        const globalStaticQueries = new Set<string>()
        const staticQueriesByComponents = new Map<string, Set<string>>()
        for (const [
          staticQueryId,
          modules,
        ] of webpackModulesByStaticQueryId.entries()) {
          for (const module of modules) {
            traverseModule(module, {
              onComponent(component: IGatsbyPageComponent) {
                let staticQueriesForComponent = staticQueriesByComponents.get(
                  component.componentPath
                )
                if (!staticQueriesForComponent) {
                  staticQueriesForComponent = new Set()
                  staticQueriesByComponents.set(
                    component.componentPath,
                    staticQueriesForComponent
                  )
                }

                staticQueriesForComponent.add(staticQueryId)
              },
              onRoot() {
                globalStaticQueries.add(staticQueryId)
              },
            })
          }
        }

        let globalSliceUsage: ICollectedSlices = {}
        const slicesByComponents = new Map<string, ICollectedSlices>()
        for (const [
          module,
          slices,
        ] of webpackModulesByUsedSlicePlaceholderAlias.entries()) {
          traverseModule(module, {
            onComponent(component: IGatsbyPageComponent) {
              slicesByComponents.set(
                component.componentPath,
                mergePreviouslyCollectedSlices(
                  slices,
                  slicesByComponents.get(component.componentPath)
                )
              )
            },
            onRoot() {
              globalSliceUsage = mergePreviouslyCollectedSlices(
                slices,
                globalSliceUsage
              )
            },
          })
        }

        for (const component of components.values()) {
          const allStaticQueries = new Set([
            ...globalStaticQueries,
            ...(staticQueriesByComponents.get(component.componentPath) ?? []),
          ])
          const staticQueryHashes = Array.from(allStaticQueries).sort()

          const allSlices = mergePreviouslyCollectedSlices(
            slicesByComponents.get(component.componentPath) ?? {},
            component.isSlice ? {} : cloneDeep(globalSliceUsage)
          )

          const slices = Object.keys(allSlices)
            .sort()
            .reduce((obj, key) => {
              obj[key] = allSlices[key]
              return obj
            }, {})

          const didSlicesChange = !isEqual(
            this.store.getState().slicesByTemplate.get(component.componentPath),
            slices
          )
          const didStaticQueriesChange = !isEqual(
            this.store
              .getState()
              .staticQueriesByTemplate.get(component.componentPath),
            staticQueryHashes
          )

          if (didStaticQueriesChange || didSlicesChange) {
            if (component.isSlice) {
              this.store.dispatch({
                type: `ADD_PENDING_SLICE_TEMPLATE_DATA_WRITE`,
                payload: {
                  componentPath: component.componentPath,
                  sliceNames: component.pages,
                },
              })
            } else {
              this.store.dispatch({
                type: `ADD_PENDING_TEMPLATE_DATA_WRITE`,
                payload: {
                  componentPath: component.componentPath,
                  pages: component.pages,
                },
              })
            }
          }

          if (didSlicesChange) {
            this.store.dispatch({
              type: `SET_SLICES_BY_TEMPLATE`,
              payload: {
                componentPath: component.componentPath,
                slices,
              },
            })
          }

          if (didStaticQueriesChange) {
            this.store.dispatch({
              type: `SET_STATIC_QUERIES_BY_TEMPLATE`,
              payload: {
                componentPath: component.componentPath,
                staticQueryHashes,
              },
            })
          }
        }
      }
    )
  }
}
