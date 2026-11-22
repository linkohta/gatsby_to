/**
 * JS にコンパイルされる他の言語への対応を実装するプラグインが、「解決できる」
 * 拡張子の一覧に追加できるようにする。Gatsby はデフォルトで `.js` と `.jsx` に対応している。
 * @returns {Array<string>} 拡張子の配列
 */
export const resolvableExtensions = true

/**
 * ページを動的に作成する。この拡張ポイントは、最初のノードの取得と変換、
 * および GraphQL スキーマの作成が完了した後にだけ呼ばれるので、
 * ページを作成するためにデータをクエリできる。
 *
 * リモートまたはローカルのソースからデータを取得してページを作成することもできる。
 *
 * [アクション `createPage` のドキュメント](/docs/actions/#createPage) も参照。
 *
 * @param {object} $0 詳しくは [`Node API Helpers` のドキュメント](/docs/node-api-helpers) を参照
 * @param {Actions} $0.actions [ドキュメント化されているアクションの一覧](/docs/actions) を参照
 * @param {function} $0.actions.createPage [このアクションのドキュメント](/docs/actions/#createPage)
 * @param {function} $0.graphql: GraphQL API にクエリする。[こちらの例](/docs/creating-and-modifying-pages/#creating-pages-in-gatsby-nodejs) を参照
 * @param {GatsbyReporter} $0.reporter 問題をログに出力する。詳しくは [GatsbyReporter のドキュメント](/docs/node-api-helpers/#GatsbyReporter) を参照
 * @returns {Promise<void>} 戻り値は不要だが、Promise が返された場合、呼び出し側はそれを `await` する
 *
 * @example
 * const path = require(`path`)
 *
 * exports.createPages = ({ graphql, actions }) => {
 *   const { createPage } = actions
 *   const blogPostTemplate = path.resolve(`src/templates/blog-post.js`)
 *   // Query for markdown nodes to use in creating pages.
 *   // You can query for whatever data you want to create pages for e.g.
 *   // products, portfolio items, landing pages, etc.
 *   // Variables can be added as the second function parameter
 *   return graphql(`
 *     query loadPagesQuery ($limit: Int!) {
 *       allMarkdownRemark(limit: $limit) {
 *         edges {
 *           node {
 *             frontmatter {
 *               slug
 *             }
 *           }
 *         }
 *       }
 *     }
 *   `, { limit: 1000 }).then(result => {
 *     if (result.errors) {
 *       throw result.errors
 *     }
 *
 *     // Create blog post pages.
 *     result.data.allMarkdownRemark.edges.forEach(edge => {
 *       createPage({
 *         // Path for this page — required
 *         path: `${edge.node.frontmatter.slug}`,
 *         component: blogPostTemplate,
 *         context: {
 *           // Add optional context data to be inserted
 *           // as props into the page component.
 *           //
 *           // The context data can also be used as
 *           // arguments to the page GraphQL query.
 *           //
 *           // The page "path" is always available as a GraphQL
 *           // argument.
 *         },
 *       })
 *     })
 *   })
 * }
 */

export const createPages = true

/**
 * `createPages` に似ているが、Gatsby が管理して *いない* データの変更に応じて、
 * ページの作成と削除を自分で管理したいプラグインのためのものである。
 * `createPages` を実装するプラグインは、Gatsby のデータが変わるたびにページの情報を
 * 再計算するために定期的に呼ばれるが、`createPagesStatefully` を
 * 実装するプラグインは呼ばれない。
 *
 * この拡張ポイントを使うプラグインの例として、
 * [gatsby-plugin-page-creator](https://github.com/gatsbyjs/gatsby/tree/master/packages/gatsby-plugin-page-creator)
 * がある。このプラグインは、`src/pages` ディレクトリを監視して、JS のページの
 * 追加と削除を検出する。その情報源である pages ディレクトリのファイルを Gatsby は
 * 把握していないので、ページをいつ追加して削除するかを知るために、
 * 自分の状態を自分で保持する必要がある。
 */
export const createPagesStatefully = true

/**
 * プラグインにノードの取得を指示する拡張ポイント。この API は、Gatsby の
 * bootstrap の処理の中で呼ばれる。ソースプラグインは、このフックを使ってノードを作成する。
 * この API は、プラグインごとにちょうど 1 回（およびサイトの
 * `gatsby-config.js` ファイルに対して 1 回）呼ばれる。このフックを `gatsby-node.js` で
 * 定義した場合は、すべてのソースプラグインがノードの作成を終えた後に、
 * ちょうど 1 回呼ばれる。
 *
 * チュートリアルの [Creating a Source
 * Plugin](/docs/how-to/plugins-and-themes/creating-a-source-plugin/) で、
 * プラグインやサイトがこの API を使う方法の一例を紹介している。
 *
 * [`createNode`](/docs/actions/#createNode) のドキュメントも参照。
 * @example
 * exports.sourceNodes = ({ actions, createNodeId, createContentDigest }) => {
 *   const { createNode } = actions
 *
 *   // Data can come from anywhere, but for now create it manually
 *   const myData = {
 *     key: 123,
 *     foo: `The foo field of my node`,
 *     bar: `Baz`
 *   }
 *
 *   const nodeContent = JSON.stringify(myData)
 *
 *   const nodeMeta = {
 *     id: createNodeId(`my-data-${myData.key}`),
 *     parent: null,
 *     children: [],
 *     internal: {
 *       type: `MyNodeType`,
 *       mediaType: `text/html`,
 *       content: nodeContent,
 *       contentDigest: createContentDigest(myData)
 *     }
 *   }
 *
 *   const node = Object.assign({}, myData, nodeMeta)
 *   createNode(node)
 * }
 */
export const sourceNodes = true

/**
 * 新しいノードが作成されたときに呼ばれる。他のプラグインが作成したノードを
 * 拡張または変換したいプラグインは、この API を実装する。
 *
 * [`createNode`](/docs/actions/#createNode) と
 * [`createNodeField`](/docs/actions/#createNodeField) のドキュメントも参照
 *
 * チュートリアルの [Creating a Source
 * Plugin](/docs/how-to/plugins-and-themes/creating-a-source-plugin/) で、
 * プラグインやサイトがこの API を使う方法の一例を紹介している。
 *
 * @example
 * exports.onCreateNode = ({ node, actions }) => {
 *   const { createNode, createNodeField } = actions
 *   // Transform the new node here and create a new node or
 *   // create a new node field.
 * }
 */
export const onCreateNode = true

/**
 * プラグインの `onCreateNode` コールバックを予約する前に呼ばれる。falsy な値を返すと、
 * Gatsby は、このノードとこのプラグインについての `onCreateNode` コールバックを予約しない。
 * 注: この API は、他のコールバックが第 1 引数として受け取る通常の `api` を受け取らない。
 *
 * @gatsbyVersion 5.0.0
 * @example
 * exports.shouldOnCreateNode = ({node}, pluginOptions) => node.internal.type === 'Image'
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const shouldOnCreateNode = true

/**
 * 新しいページが作成されたときに呼ばれる。この拡張 API は、他のプラグインが
 * 作成したページをプログラムから操作するのに役立つ。たとえば、
 * 末尾のスラッシュがないパスにしたい場合など。
 *
 * Gatsby には、無限ループや無限のコールバックを避けるために、同じ gatsby-node.js が
 * 作成したページに対して onCreatePage を呼ばないようにする仕組みがある。
 *
 * この API について詳しくは、ガイドの [Creating and Modifying Pages](/docs/creating-and-modifying-pages/)
 * を参照。
 */
export const onCreatePage = true

/**
 * GraphQL スキーマの作成中に呼ばれる。プラグインが、データノードから
 * 作成された型に新しいフィールドを追加できるようにする。型ごとに
 * 別々に呼ばれる。
 *
 * この関数は、
 * [GraphQLFieldConfigMap](https://graphql.org/graphql-js/type/#graphqlobjecttype)
 * の形のオブジェクトを返すこと。返したものは、Gatsby がデータノードから推論したフィールドに追加される。
 *
 * *注:* GraphQL の型は `gatsby/graphql` から import し、`graphql`
 * パッケージをプロジェクトやプラグインの依存に追加しないこと。`Schema must
 * contain unique named types but contains multiple types named` のエラーを避けるためである。
 * `gatsby/graphql` は、すべての組み込みの GraphQL の型に加えて、`GraphQLJSON`
 * 型も export している。
 *
 * 多くのトランスフォーマープラグインが、引数を取るフィールドを追加するためにこれを使っている。
 *
 * * [`gatsby-transformer-remark`](/plugins/gatsby-transformer-remark/)
 * は "excerpt" フィールドを追加する。ユーザーはクエリを書くときに、
 * markdown のソースを何文字に切り詰めるかを指定できる。
 * * [`gatsby-transformer-sharp`](/plugins/gatsby-transformer-sharp/) は、
 * 多くの画像変換のオプションを GraphQL のフィールドとして公開している。
 *
 * @param {object} $0
 * @param {object} $0.type `name` と `nodes` を含むオブジェクト
 * @example
 * import { GraphQLString } from "gatsby/graphql"
 *
 * exports.setFieldsOnGraphQLNodeType = ({ type }) => {
 *   if (type.name === `File`) {
 *     return {
 *       newField: {
 *         type: GraphQLString,
 *         args: {
 *           myArgument: {
 *             type: GraphQLString,
 *           }
 *         },
 *         resolve: (source, fieldArgs) => {
 *           return `Id of this node is ${source.id}.
 *                   Field was called with argument: ${fieldArgs.myArgument}`
 *         }
 *       }
 *     }
 *   }
 *
 *   // by default return empty object
 *   return {}
 * }
 */
export const setFieldsOnGraphQLNodeType = true

/**
 * 型定義やフィールド拡張の作成、サードパーティーのスキーマの追加によって、
 * Gatsby の GraphQL スキーマをカスタマイズする。
 *
 * [`createTypes`](/docs/actions/#createTypes)、
 * [`createFieldExtension`](/docs/actions/#createFieldExtension)、
 * [`addThirdPartySchema`](/docs/actions/#addThirdPartySchema) のアクションは、
 * この API の中でだけ使える。使い方の詳細については、
 * アクションのドキュメントを参照。
 *
 * この API は、スキーマの生成の直前に実行される。生成されたスキーマを
 * 変更する（たとえば、追加されたサードパーティーの型をカスタマイズする）には、
 * [`createResolvers`](/docs/node-apis/#createResolvers) API を使う。
 *
 * @gatsbyVersion 2.12.0
 * @param {object} $0
 * @param {object} $0.actions
 * @param {object} $0.actions.createTypes
 * @param {object} $0.actions.createFieldExtension
 * @param {object} $0.actions.addThirdPartySchema
 * @example
 * exports.createSchemaCustomization = ({ actions }) => {
 *   const { createTypes, createFieldExtension } = actions
 *
 *   createFieldExtension({
 *     name: 'shout',
 *     extend: () => ({
 *       resolve(source, args, context, info) {
 *         return String(source[info.fieldName]).toUpperCase()
 *       }
 *     })
 *   })
 *
 *   const typeDefs = `
 *     type MarkdownRemark implements Node @dontInfer {
 *       frontmatter: Frontmatter
 *     }
 *     type Frontmatter {
 *       title: String!
 *       tagline: String @shout
 *       date: Date @dateformat
 *       image: File @fileByRelativePath
 *     }
 *   `
 *   createTypes(typeDefs)
 * }
 */
export const createSchemaCustomization = true

/**
 * GraphQL スキーマに独自のフィールドリゾルバーを追加する。
 *
 * フィールドの設定を渡して型に新しいフィールドを追加したり、既存のフィールドに
 * リゾルバー関数を追加したりできる。
 *
 * 注意点:
 * * フィールドの型の上書きは許可されていない。代わりに `createTypes`
 *   アクションを使う。サードパーティーのスキーマから追加された型では、それが
 *   できないので、フィールドの型の上書きが許可されている。
 * * 新しいフィールドは、`filter` と `sort` の入力型では使えない。必要な場合は、
 *   `createTypes` で定義した型を拡張する。
 * * フィールドの設定では、型を文字列で参照できる。
 * * 既存のフィールドリゾルバーを持つフィールドを拡張する場合、元の
 *   リゾルバー関数は `info.originalResolver` から利用できる。
 * * `createResolvers` API は、スキーマの生成の最後のステップとして呼ばれる。
 *   そのため、`intermediateSchema` プロパティで中間のスキーマを利用できる。
 *   リゾルバー関数自体の中では、最終的にビルドされたスキーマに
 *   `info.schema` からアクセスすることを推奨する。
 * * すべての内部のクエリ機能を含む Gatsby のデータレイヤーは、
 *   [`context.nodeModel`](/docs/node-model/) で公開されている。ノードストアには、
 *   `findOne`、`getNodeById`、`getNodesByIds` で直接クエリでき、
 *   より高度なクエリは `findAll` で組み立てられる。
 * * ルートの `Query` 型にフィールドを追加することもできる。
 * * リゾルバーの第 1 引数（下の例では `source`。
 *   `parent` や `root` と呼ばれることも多い）を使うときは、1 つのクエリの中で
 *   フィールドリゾルバーが複数回呼ばれうることに注意する。たとえば、そのフィールドが
 *   入力のフィルターと選択セットの両方にある場合である。つまり、
 *   `source` の外部キーのフィールドは、解決済みのこともあれば未解決のこともある。
 *
 * より詳しい例については、[`using-type-definitions`](https://github.com/gatsbyjs/gatsby/tree/master/examples/using-type-definitions) を参照。
 *
 * @gatsbyVersion 2.2.0
 * @param {object} $0
 * @param {GraphQLSchema} $0.intermediateSchema 現在の GraphQL スキーマ
 * @param {function} $0.createResolvers GraphQL のフィールドの設定に独自のリゾルバーを追加する
 * @param {object} $1
 * @param {object} $1.resolvers GraphQL の型名から独自のリゾルバー関数へのオブジェクトのマップ
 * @param {object} $1.options createResolvers のオプション（省略可能）
 * @param {object} $1.options.ignoreNonexistentTypes 存在しない型にリゾルバーを追加しようとしたときの警告を抑止する。省略可能な拡張で役に立つ。
 * @example
 * exports.createResolvers = ({ createResolvers }) => {
 *   const resolvers = {
 *     Author: {
 *       fullName: {
 *         resolve: (source, args, context, info) => {
 *           return source.firstName + source.lastName
 *         }
 *       },
 *     },
 *     Query: {
 *       allRecentPosts: {
 *         type: [`BlogPost`],
 *         resolve: async (source, args, context, info) => {
 *           const { entries } = await context.nodeModel.findAll({ type: `BlogPost` })
 *           return entries.filter(
 *             post => post.publishedAt > Date.UTC(2018, 0, 1)
 *           )
 *         }
 *       }
 *     }
 *   }
 *   createResolvers(resolvers)
 * }
 */
export const createResolvers = true

/**
 * JS にコンパイルするプラグインに、ソースを JavaScript へ変換するよう依頼する。
 * クエリランナーが、実行する GraphQL クエリを抽出できるようにするためである。
 */
export const preprocessSource = true

/**
 * プラグインが、
 * [`setBabelPlugin`](/docs/actions/#setBabelPlugin) または
 * [`setBabelPreset`](/docs/actions/#setBabelPreset) を呼ぶことで、サイトの Babel の設定を拡張または変更できるようにする。
 * @param {object} $0
 * @param {string} $0.stage 現在のビルドのステージ。'develop'、'develop-html'、
 * 'build-javascript'、'build-html' のいずれか
 * @param {object} $0.actions
 * @param {object} options Babel の設定
 * @example
 * exports.onCreateBabelConfig = ({ actions }) => {
 *   actions.setBabelPlugin({
 *     name: `babel-plugin-that-i-like`,
 *     options: {}
 *   })
 * }
 */
export const onCreateBabelConfig = true

/**
 * プラグインが、サイトの webpack の設定を拡張または変更できるようにする。このメソッドは、プラグインに限らず、あらゆる Gatsby のサイト、アプリ、プラグインから使える。
 *
 * [`setWebpackConfig`](/docs/actions/#setWebpackConfig) のドキュメントも参照。
 *
 * @param {object} $0
 * @param {string} $0.stage 現在のビルドのステージ。'develop'、'develop-html'、
 * 'build-javascript'、'build-html' のいずれか
 * @param {function} $0.getConfig 現在の webpack の設定を返す
 * @param {object} $0.rules あらかじめ設定された webpack の設定のルール一式
 * @param {object} $0.loaders あらかじめ設定された webpack の設定のローダー一式
 * @param {object} $0.plugins あらかじめ設定された webpack の設定のプラグイン一式
 * @param {object} $0.actions
 * @example
 * exports.onCreateWebpackConfig = ({
 *  stage, getConfig, rules, loaders, actions
 * }) => {
 *   actions.setWebpackConfig({
 *     module: {
 *       rules: [
 *         {
 *           test: 'my-css',
 *           use: [loaders.style(), loaders.css()]
 *         },
 *       ],
 *     },
 *   });
 * }
 */
export const onCreateWebpackConfig = true

/**
 * Gatsby の実行中に最初に呼ばれる API。プラグインが読み込まれるとすぐに、キャッシュの初期化と bootstrap の準備より前に実行される。
 *
 * @param {object} $0
 * @param {object} $0.actions
 * @example
 * exports.onPreInit = ({ actions }) => {
 *
 * }
 */
export const onPreInit = true

/**
 * 各プロセスで（プロセスごとに 1 回）実行されるライフサイクル。アクションなどを後で使うために保存するのに使う。
 *
 * @example
 * let createJobV2
 * exports.onPluginInit = ({ actions }) => {
 *   // store job creation action to use it later
 *   createJobV2 = actions.createJobV2
 * }
 * @gatsbyVersion 3.9.0
 */
export const onPluginInit = true

/**
 * Gatsby が自身の初期化を終え、サイトの bootstrap を始める準備ができたときに呼ばれる。
 */
export const onPreBootstrap = true

/**
 * bootstrap の処理の最後に、他のすべての拡張 API が呼ばれた後で呼ばれる。
 */
export const onPostBootstrap = true

/**
 * ビルドの処理の中で最初に呼ばれる拡張ポイント。bootstrap が完了した後、ビルドのステップが始まる前に呼ばれる。
 */
export const onPreBuild = true

/**
 * ビルドの処理の他のすべての部分が完了した後に呼ばれる、
 * 最後の拡張ポイント。
 *
 * @example
 * exports.onPostBuild = ({ reporter, basePath, pathPrefix }) => {
 *  reporter.info(
 *   `Site was built with basePath: ${basePath} & pathPrefix: ${pathPrefix}`
 *  );
 * };
 */
export const onPostBuild = true

/**
 * JavaScript ファイルから GraphQL のクエリやフラグメントが抽出される前に実行される。プラグインが、
 * クエリやフラグメントを含む JavaScript ファイル（たとえば node_modules の中のもの）を追加するのに役立つ。
 *
 * 例については、gatsby-transformer-sharp と gatsby-source-contentful を参照。
 */
export const onPreExtractQueries = true

/**
 * `gatsby develop` のサーバーが起動したときに実行される。サーバーにプロキシや Express のミドルウェアを
 * 追加するために使える。
 * @param {object} $0
 * @param {Express} $0.app 開発サーバーの実行に使われる [Express の app](https://expressjs.com/en/4x/api.html#app)
 * @example
 * exports.onCreateDevServer = ({ app }) => {
 *   app.get('/hello', function (req, res) {
 *     res.send('hello world')
 *   })
 * }
 */
export const onCreateDevServer = true

/**
 * bootstrap の段階で実行される。プラグインはこれを使って、
 * [Joi](https://joi.dev) でオプションのスキーマを定義し、ユーザーがプラグインに渡すオプションを検証できる。
 * @gatsbyVersion 2.25.0
 * @param {object} $0
 * @param {Joi} $0.Joi スキーマを定義するための [Joi](https://joi.dev) のインスタンス
 * @example
 * exports.pluginOptionsSchema = ({ Joi }) => {
 *   return Joi.object({
 *     // Validate that the anonymize option is defined by the user and is a boolean
 *     anonymize: Joi.boolean().required(),
 *   })
 * }
 */
export const pluginOptionsSchema = true
