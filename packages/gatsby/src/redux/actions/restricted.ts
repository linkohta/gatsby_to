import camelCase from "lodash/camelCase"
import isEqual from "lodash/isEqual"

import { GraphQLSchema, GraphQLOutputType } from "graphql"
import { ActionCreator } from "redux"
import { ThunkAction } from "redux-thunk"
import report from "gatsby-cli/lib/reporter"
import { parseTypeDef } from "../../schema/types/type-defs"
import {
  GraphQLFieldExtensionDefinition,
  reservedExtensionNames,
} from "../../schema/extensions"
import { GatsbyGraphQLType } from "../../schema/types/type-builders"
import {
  IGatsbyPlugin,
  ActionsUnion,
  IAddThirdPartySchema,
  ICreateTypes,
  IGatsbyState,
  ICreateFieldExtension,
  IPrintTypeDefinitions,
  ICreateResolverContext,
  IGatsbyPluginContext,
  ICreateSliceAction,
  IAddImageCdnAllowedUrl,
} from "../types"
import { generateComponentChunkName } from "../../utils/js-chunk-names"
import { store } from "../index"
import normalizePath from "normalize-path"
import { validateComponent } from "../../utils/validate-component"

type RestrictionActionNames =
  | `createFieldExtension`
  | `createTypes`
  | `createResolverContext`
  | `addThirdPartySchema`
  | `printTypeDefinitions`
  | `createSlice`
  | `addRemoteFileAllowedUrl`

type SomeActionCreator =
  | ActionCreator<ActionsUnion>
  | ActionCreator<ThunkAction<any, IGatsbyState, any, ActionsUnion>>

export interface ICreateSliceInput {
  id: string
  component: string
  context: Record<string, unknown>
}

export const actions = {
  /**
   * メインのスキーマにマージするサードパーティーのスキーマを追加する。スキーマは
   * graphql-js の GraphQLSchema オブジェクトでなければならない。
   *
   * このスキーマはそのままマージされる。この方法でマージすると、
   * Gatsby のメインのスキーマを簡単に壊してしまう。それは避けたいので、
   * そうならないようにするのはユーザーの責任である。
   * 避ける方法の 1 つは、スキーマに名前空間を付けることである。
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {Object} $0
   * @param {GraphQLSchema} $0.schema 追加する GraphQL スキーマ
   */
  addThirdPartySchema: (
    { schema }: { schema: GraphQLSchema },
    plugin: IGatsbyPlugin,
    traceId?: string
  ): IAddThirdPartySchema => {
    return {
      type: `ADD_THIRD_PARTY_SCHEMA`,
      plugin,
      traceId,
      payload: schema,
    }
  },

  /**
   * GraphQL スキーマに型定義を追加する。
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {string | GraphQLOutputType | GatsbyGraphQLType | string[] | GraphQLOutputType[] | GatsbyGraphQLType[]} types 型定義
   *
   * 型定義は、
   * [`graphql-js` の型](https://graphql.org/graphql-js/)、
   * [GraphQL のスキーマ定義言語（SDL）](https://graphql.org/learn/)、
   * または API の引数 `schema` から使える Gatsby Type Builder のいずれかで渡せる。
   *
   * 注意点:
   * * ノードの型を対象にする型定義、つまり `MarkdownRemark` や、
   *   `sourceNodes` や `onCreateNode` の API で追加されるその他の型は、
   *   `Node` インターフェースを実装する必要がある。インターフェースのフィールドは自動的に
   *   追加されるが、それらの型に `implements Node` を付けることは必須である。
   * * デフォルトでは、`createTypes` による明示的な型定義は、推論された
   *   フィールドの型とマージされる。また、`Date`（書式のオプションを
   *   追加する）と `File`（フィールドの値を `relativePath` の外部キーの
   *   フィールドとして解決する）のデフォルトのフィールドリゾルバーが追加される。この動作は、
   *   `@infer`、`@dontInfer` ディレクティブまたは extensions でカスタマイズできる。フィールドには、
   *   追加のディレクティブでリゾルバー（や args などのオプション）を
   *   割り当てられる。現在は `@dateformat`、`@link`、`@fileByRelativePath`、
   *   `@proxy` が使える。
   *
   *
   * スキーマのカスタマイズの制御:
   * * `@infer` - 型に対して推論を実行し、定義された型に存在しないフィールドを
   * 追加する。
   * * `@dontInfer` - 型に対して推論を一切実行しない
   *
   * リゾルバーのオプションを追加する拡張:
   * * `@dateformat` - 日付の書式の引数を追加する。このフィールドのデフォルトを
   *   設定する `formatString` と `locale` のオプションを受け取る
   * * `@link` - 別の Node に接続する。引数は `by` と `from` で、
   *   接続先のノードのどのフィールドと比較するかと、接続元のノードのどのフィールドを
   *   使うかを指定する
   * * `@fileByRelativePath` - File ノードに接続する。引数は同じ。
   *   link との違いは、相対パスを、接続元のノードがある場所からの
   *   相対パスになるように正規化することである。
   * * `@proxy` - 元になるノードのデータに、GraphQL で無効な文字を含む
   *   フィールド名がある場合に、`proxy` を使うと、それらのプロパティを
   *   有効な名前のフィールドへ明示的にプロキシできる。引数 `from` を受け取る。
   *
   *
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   const { createTypes } = actions
   *   const typeDefs = `
   *     """
   *     Markdown Node
   *     """
   *     type MarkdownRemark implements Node @infer {
   *       frontmatter: Frontmatter!
   *     }
   *
   *     """
   *     Markdown Frontmatter
   *     """
   *     type Frontmatter @infer {
   *       title: String!
   *       author: AuthorJson! @link
   *       date: Date! @dateformat
   *       published: Boolean!
   *       tags: [String!]!
   *     }
   *
   *     """
   *     Author information
   *     """
   *     # Does not include automatically inferred fields
   *     type AuthorJson implements Node @dontInfer {
   *       name: String!
   *       birthday: Date! @dateformat(locale: "ru")
   *     }
   *   `
   *   createTypes(typeDefs)
   * }
   *
   * // using Gatsby Type Builder API
   * exports.createSchemaCustomization = ({ actions, schema }) => {
   *   const { createTypes } = actions
   *   const typeDefs = [
   *     schema.buildObjectType({
   *       name: 'MarkdownRemark',
   *       fields: {
   *         frontmatter: 'Frontmatter!'
   *       },
   *       interfaces: ['Node'],
   *       extensions: {
   *         infer: true,
   *       },
   *     }),
   *     schema.buildObjectType({
   *       name: 'Frontmatter',
   *       fields: {
   *         title: {
   *           type: 'String!',
   *           resolve(parent) {
   *             return parent.title || '(Untitled)'
   *           }
   *         },
   *         author: {
   *           type: 'AuthorJson'
   *           extensions: {
   *             link: {},
   *           },
   *         }
   *         date: {
   *           type: 'Date!'
   *           extensions: {
   *             dateformat: {},
   *           },
   *         },
   *         published: 'Boolean!',
   *         tags: '[String!]!',
   *       }
   *     }),
   *     schema.buildObjectType({
   *       name: 'AuthorJson',
   *       fields: {
   *         name: 'String!'
   *         birthday: {
   *           type: 'Date!'
   *           extensions: {
   *             dateformat: {
   *               locale: 'ru',
   *             },
   *           },
   *         },
   *       },
   *       interfaces: ['Node'],
   *       extensions: {
   *         infer: false,
   *       },
   *     }),
   *   ]
   *   createTypes(typeDefs)
   * }
   */
  createTypes: (
    types:
      | string
      | GraphQLOutputType
      | GatsbyGraphQLType<any, any>
      | Array<string | GraphQLOutputType | GatsbyGraphQLType<any, any>>,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): ICreateTypes => {
    return {
      type: `CREATE_TYPES`,
      plugin,
      traceId,
      payload: Array.isArray(types)
        ? types.map(parseTypeDef)
        : parseTypeDef(types),
    }
  },

  /**
   * GraphQL スキーマにフィールド拡張を追加する。
   *
   * 拡張を使うと独自の動作を定義でき、ディレクティブ（SDL の場合）または
   * `extensions` プロパティ（Type Builder の場合）でフィールドに追加できる。
   *
   * 拡張の定義は、`name`、`extend` 関数、省略可能なオプション用の
   * `args` を受け取る。`extend` 関数は（部分的な）フィールドの設定を
   * 返さなければならず、拡張のオプションと直前のフィールドの設定を
   * 引数として受け取る。
   *
   * @availableIn [createSchemaCustomization, sourceNodes]
   *
   * @param {GraphQLFieldExtensionDefinition} extension フィールド拡張の定義
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   const { createFieldExtension } = actions
   *   createFieldExtension({
   *     name: 'motivate',
   *     args: {
   *       caffeine: 'Int'
   *     },
   *     extend(options, prevFieldConfig) {
   *       return {
   *         type: 'String',
   *         args: {
   *           sunshine: {
   *             type: 'Int',
   *             defaultValue: 0,
   *           },
   *         },
   *         resolve(source, args, context, info) {
   *           const motivation = (options.caffeine || 0) - args.sunshine
   *           if (motivation > 5) return 'Work! Work! Work!'
   *           return 'Maybe tomorrow.'
   *         },
   *       }
   *     },
   *   })
   * }
   */
  createFieldExtension:
    (
      extension: GraphQLFieldExtensionDefinition,
      plugin: IGatsbyPlugin,
      traceId?: string
    ): ThunkAction<
      void,
      IGatsbyState,
      Record<string, unknown>,
      ICreateFieldExtension
    > =>
    (dispatch, getState): void => {
      const { name } = extension || {}
      const { fieldExtensions } = getState().schemaCustomization

      if (!name) {
        report.error(
          `The provided field extension must have a \`name\` property.`
        )
      } else if (reservedExtensionNames.includes(name)) {
        report.error(
          `The field extension name \`${name}\` is reserved for internal use.`
        )
      } else if (fieldExtensions[name]) {
        report.error(
          `A field extension with the name \`${name}\` has already been registered.`
        )
      } else {
        dispatch({
          type: `CREATE_FIELD_EXTENSION`,
          plugin,
          traceId,
          payload: { name, extension },
        })
      }
    },

  /**
   * GraphQL スキーマをファイルに書き出す
   *
   * 推論された型定義と、明示的に指定された型定義を書き出す。これは完全な
   * GraphQL スキーマではなく、すべての型定義を作り直すのに必要な型だけである。
   * つまり、ディレクティブ、組み込みの型、フィルターやソートやページネーションなどの
   * ための派生型は含まれない。必要に応じて、含める型や除外する型の一覧を
   * 指定できる。プラグインが作成した型の定義を含めないようにするために、
   * 指定することを推奨する。
   *
   * 最初のオブジェクトの引数は必須だが、オブジェクトの中のフィールドはすべて省略できる。
   *
   * @availableIn [createSchemaCustomization]
   *
   * @param {object} $0
   * @param {string} [$0.path] 出力ファイルへのパス。デフォルトは `schema.gql`
   * @param {object} [$0.include] 含める型を設定する
   * @param {string[]} [$0.include.types] これらの型だけを含める
   * @param {string[]} [$0.include.plugins] これらのプラグインが所有する型だけを含める
   * @param {object} [$0.exclude] 除外する型を設定する
   * @param {string[]} [$0.exclude.types] これらの型を含めない
   * @param {string[]} [$0.exclude.plugins] これらのプラグインが所有する型を含めない
   * @param {boolean} [$0.withFieldTypes] フィールドの型を含める。デフォルトは `true`
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   // This code writes a GraphQL schema to a file named `schema.gql`.
   *   actions.printTypeDefinitions({})
   * }
   * @example
   * exports.createSchemaCustomization = ({ actions }) => {
   *   // This code writes a GraphQL schema to a file named `schema.gql`, but this time it does not include field types.
   *   actions.printTypeDefinitions({ withFieldTypes: false })
   * }
   */
  printTypeDefinitions: (
    {
      path = `schema.gql`,
      include,
      exclude,
      withFieldTypes = true,
    }: {
      path?: string
      include?: { types?: Array<string>; plugins?: Array<string> }
      exclude?: { types?: Array<string>; plugins?: Array<string> }
      withFieldTypes?: boolean
    },
    plugin: IGatsbyPlugin,
    traceId?: string
  ): IPrintTypeDefinitions => {
    return {
      type: `PRINT_SCHEMA_REQUESTED`,
      plugin,
      traceId,
      payload: {
        path,
        include,
        exclude,
        withFieldTypes,
      },
    }
  },

  /**
   * フィールドリゾルバーの `context` から機能を使えるようにする
   *
   * @availableIn [createSchemaCustomization]
   *
   * @param {object} context `context` から使えるようにするオブジェクト。
   * プラグインから呼ばれた場合、コンテキストの値は、"gatsby-" プレフィックスを
   * 除いてキャメルケースにしたプラグイン名の名前空間の下に置かれる
   * @example
   * const getHtml = md => remark().use(html).process(md)
   * exports.createSchemaCustomization = ({ actions }) => {
   *   actions.createResolverContext({ getHtml })
   * }
   * // The context value can then be accessed in any field resolver like this:
   * exports.createSchemaCustomization = ({ actions, schema }) => {
   *   actions.createTypes(schema.buildObjectType({
   *     name: 'Test',
   *     interfaces: ['Node'],
   *     fields: {
   *       md: {
   *         type: 'String!',
   *         async resolve(source, args, context, info) {
   *           const processed = await context.transformerRemark.getHtml(source.internal.contents)
   *           return processed.contents
   *         }
   *       }
   *     }
   *   }))
   * }
   */
  createResolverContext:
    (
      context: IGatsbyPluginContext,
      plugin: IGatsbyPlugin,
      traceId?: string
    ): ThunkAction<
      void,
      IGatsbyState,
      Record<string, unknown>,
      ICreateResolverContext
    > =>
    (dispatch): void => {
      if (!context || typeof context !== `object`) {
        report.error(
          `Expected context value passed to \`createResolverContext\` to be an object. Received "${context}".`
        )
      } else {
        const { name } = plugin || {}
        const payload =
          !name || name === `default-site-plugin`
            ? context
            : { [camelCase(name.replace(/^gatsby-/, ``))]: context }
        dispatch({
          type: `CREATE_RESOLVER_CONTEXT`,
          plugin,
          traceId,
          payload,
        })
      }
    },

  /**
   * 新しい Slice を作成する。[Gatsby Slice API](/docs/reference/built-in-components/gatsby-slice) の技術ドキュメントを参照。
   *
   * @availableIn [createPages]
   *
   * @param {object} $0
   * @param {Object} slice スライスオブジェクト
   * @param {string} slice.id このスライスの一意な ID
   * @param {string} slice.component このスライスのコンポーネントへの絶対パス
   * @param {Object} slice.context このスライスのコンテキストデータ。props として
   * コンポーネントの `this.props.sliceContext` に渡されるほか、graphql クエリにも
   * graphql の引数として渡される。
   * @example
   * exports.createPages = ({ actions }) => {
   *   actions.createSlice({
   *     id: `navigation-bar`,
   *     component: path.resolve(`./src/components/navigation-bar.js`),
   *   })
   * }
   */
  createSlice: (
    payload: ICreateSliceInput,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): ICreateSliceAction => {
    if (_CFLAGS_.GATSBY_MAJOR === `5` && process.env.GATSBY_SLICES) {
      let name = `The plugin "${plugin.name}"`
      if (plugin.name === `default-site-plugin`) {
        name = `Your site's "gatsby-node.js"`
      }

      if (!payload.id) {
        const message = `${name} must set the page path when creating a slice`
        report.panic({
          id: `11334`,
          context: {
            pluginName: name,
            sliceObject: payload,
            message,
          },
        })
      }

      const { slices } = store.getState()

      const { error, panicOnBuild } = validateComponent({
        input: payload,
        pluginName: name,
        errorIdMap: {
          noPath: `11333`,
          notAbsolute: `11335`,
          doesNotExist: `11336`,
          empty: `11337`,
          noDefaultExport: `11338`,
        },
      })

      if (error && process.env.NODE_ENV !== `test`) {
        if (panicOnBuild) {
          report.panicOnBuild(error)
        } else {
          report.panic(error)
        }
      }

      const componentPath = normalizePath(payload.component)

      const oldSlice = slices.get(payload.id)
      const contextModified =
        !!oldSlice && !isEqual(oldSlice.context, payload.context)
      const componentModified =
        !!oldSlice && !isEqual(oldSlice.componentPath, componentPath)

      return {
        type: `CREATE_SLICE`,
        plugin,
        payload: {
          componentChunkName: generateComponentChunkName(
            payload.component,
            `slice`
          ),
          componentPath,
          // 注: 内部では id ではなく "name" を使う
          name: payload.id,
          context: payload.context || {},
          updatedAt: Date.now(),
        },
        traceId,
        componentModified,
        contextModified,
      }
    } else {
      throw new Error(`createSlice is only available in Gatsby v5`)
    }
  },
  /**
   * 予期しない RemoteFile の URL が使われるのを防ぐために、Image CDN や File CDN での使用を許可する URL パターンを宣言する。
   *
   * @availableIn [onPreInit, onPreBootstrap, onPluginInit, createSchemaCustomization]
   *
   * @param {string | string []} url 許可する URLPattern、または URL パターンの配列。
   * URLPattern は、ワイルドカード（*）や引数のプレースホルダー（例: :id）を含められる文字列である。
   * @example
   * exports.onPreInit = ({ actions }) => {
   *   actions.addRemoteFileAllowedUrl(`https://your-wordpress-instance.com/*`)
   * }
   */
  addRemoteFileAllowedUrl: (
    url: string | Array<string>,
    plugin: IGatsbyPlugin,
    traceId?: string
  ): IAddImageCdnAllowedUrl => {
    const urls = Array.isArray(url) ? url : [url]
    return {
      type: `ADD_REMOTE_FILE_ALLOWED_URL`,
      payload: { urls },
      plugin,
      traceId,
    }
  },
}

const withDeprecationWarning =
  (
    actionName: RestrictionActionNames,
    action: SomeActionCreator,
    api: API,
    allowedIn: Array<API>
  ): SomeActionCreator =>
  (...args: Array<any>): ReturnType<ActionCreator<any>> => {
    report.warn(
      `Calling \`${actionName}\` in the \`${api}\` API is deprecated. ` +
        `Please use: ${allowedIn.map(a => `\`${a}\``).join(`, `)}.`
    )
    return action(...args)
  }

const withErrorMessage =
  (actionName: RestrictionActionNames, api: API, allowedIn: Array<API>) =>
  () =>
  // 何も dispatch しない thunk を返す
  (): void => {
    report.error(
      `\`${actionName}\` is not available in the \`${api}\` API. ` +
        `Please use: ${allowedIn.map(a => `\`${a}\``).join(`, `)}.`
    )
  }

const nodeAPIs = Object.keys(require(`../../utils/api-node-docs`))

const ALLOWED_IN = `ALLOWED_IN`
const DEPRECATED_IN = `DEPRECATED_IN`

type API = string

type Restrictions = Record<
  RestrictionActionNames,
  Partial<{
    ALLOWED_IN: Array<API>
    DEPRECATED_IN: Array<API>
  }>
>

type AvailableActionsByAPI = Record<
  API,
  { [K in RestrictionActionNames]: SomeActionCreator }
>

const set = (
  availableActionsByAPI: Record<string, any>,
  api: API,
  actionName: RestrictionActionNames,
  action: SomeActionCreator
): void => {
  availableActionsByAPI[api] = availableActionsByAPI[api] || {}
  availableActionsByAPI[api][actionName] = action
}

const mapAvailableActionsToAPIs = (
  restrictions: Restrictions
): AvailableActionsByAPI => {
  const availableActionsByAPI: AvailableActionsByAPI = {}

  const actionNames = Object.keys(restrictions) as Array<
    keyof typeof restrictions
  >
  actionNames.forEach(actionName => {
    const action = actions[actionName]

    const allowedIn: Array<API> = restrictions[actionName][ALLOWED_IN] || []
    allowedIn.forEach(api =>
      set(availableActionsByAPI, api, actionName, action)
    )

    const deprecatedIn: Array<API> =
      restrictions[actionName][DEPRECATED_IN] || []
    deprecatedIn.forEach(api =>
      set(
        availableActionsByAPI,
        api,
        actionName,
        withDeprecationWarning(actionName, action, api, allowedIn)
      )
    )

    const forbiddenIn = nodeAPIs.filter(
      api => ![...allowedIn, ...deprecatedIn].includes(api)
    )
    forbiddenIn.forEach(api =>
      set(
        availableActionsByAPI,
        api,
        actionName,
        withErrorMessage(actionName, api, allowedIn)
      )
    )
  })

  return availableActionsByAPI
}

export const availableActionsByAPI = mapAvailableActionsToAPIs({
  createFieldExtension: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
    [DEPRECATED_IN]: [`sourceNodes`],
  },
  createTypes: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
    [DEPRECATED_IN]: [`onPreInit`, `onPreBootstrap`, `sourceNodes`],
  },
  createResolverContext: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
  },
  addThirdPartySchema: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
    [DEPRECATED_IN]: [`onPreInit`, `onPreBootstrap`, `sourceNodes`],
  },
  printTypeDefinitions: {
    [ALLOWED_IN]: [`createSchemaCustomization`],
  },
  createSlice: {
    [ALLOWED_IN]: [`createPages`],
  },
  addRemoteFileAllowedUrl: {
    [ALLOWED_IN]: [
      `onPreInit`,
      `onPreBootstrap`,
      `onPluginInit`,
      `createSchemaCustomization`,
    ],
  },
})
