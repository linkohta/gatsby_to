/* eslint-disable no-unused-vars */

/***/
const GatsbyReporter = {
  /**
   * @callback GatsbyReporterFn
   * @param {string} message 表示するメッセージ
   * @returns {void}
   */

  /**
   * @callback GatsbyReporterFnWithError
   * @param {string} message 表示するメッセージ
   * @param {Error}[error] エラーオブジェクト（省略可能）
   * @returns {void}
   */

  /**
   * @type {GatsbyReporterFn}
   * @example
   * reporter.info(`text`)
   */
  info: true,

  /**
   * @type {GatsbyReporterFn}
   * @example
   * reporter.warn(`text`)
   */
  warn: true,

  /**
   * @type {GatsbyReporterFnWithError}
   * @example
   * reporter.error(`text`, new Error('something'))
   */
  error: true,

  /**
   * @type {GatsbyReporterFnWithError}
   * @example
   * reporter.panic(`text`, new Error('something'))
   */
  panic: true,

  /**
   * @type {GatsbyReporterFnWithError}
   * @example
   * reporter.panicOnBuild(`text`, new Error('something'))
   */
  panicOnBuild: true,

  /**
   * このメソッドは、CLI に --verbose オプションが渡されている
   * 場合にだけ動くことに注意
   * @type {GatsbyReporterFn}
   * @example
   * reporter.verbose(`text`)
   */
  verbose: true,

  /**
   * @callback GatsbyReporterActivityTimerFn
   * @param {string} message 表示するタイマーのメッセージ
   * @returns {ITimerReporter}
   */

  /**
   * 渡されたメッセージで新しいアクティビティタイマーを作成する。
   * 完全な [戻り値の型定義はこちら](https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby-cli/src/reporter/reporter-timer.ts#L19) を参照。
   * @type {GatsbyReporterActivityTimerFn}
   * @example
   * const activity = reporter.activityTimer(`Timer text`)
   *
   * activity.start()
   * activity.setStatus(`status text`)
   * activity.end()
   */
  activityTimer: true,
};

/***/
const GatsbyCache = {
  /**
   * キャッシュされた値を取得する
   * @param {string} key キャッシュのキー
   * @returns {Promise<any>} キャッシュされた値で解決される Promise
   * @example
   * const value = await cache.get(`unique-key`)
   */
  get: true,

  /**
   * 値をキャッシュする
   * @param {string} key キャッシュのキー
   * @param {any} value キャッシュする値
   * @returns {Promise<any>} キャッシュされた値で解決される Promise
   * @example
   * await cache.set(`unique-key`, value)
   */
  set: true,

  /**
   * キャッシュされた値を削除する
   * @param {string} key キャッシュのキー
   * @returns {Promise<void>} キーがキャッシュから削除されたときに解決される Promise
   * @example
   * await cache.del(`unique-key`)
   */
  del: true,
};

/***/
const GatsbyTracing = {
  /**
   * グローバルな tracer のインスタンス。詳しくは
   * [opentracing の Tracer のドキュメント](https://opentracing-javascript.surge.sh/classes/tracer.html)
   * を参照。
   * @type {Opentracing.Tracer}
   */
  tracer: true,

  /**
   * API の実行を表す tracer のスパン。詳しくは
   * [opentracing の Span のドキュメント](https://opentracing-javascript.surge.sh/classes/span.html)
   * を参照。
   * @type {Opentracing.Span}
   */
  parentSpan: true,

  /**
   * @callback GatsbyTracing.StartSpan
   * @param {string} spanName スパンの名前
   * @returns {Opentracing.Span}
   */

  /**
   * トレースのスパンを開始する。スパンは、現在実行中の API のスパンの子として
   * 作成される。これは、次の呼び出しの便利なラッパーである
   * ```js
   * tracing.tracer.startSpan(`span-name`, { childOf: tracing.parentSpan}).
   * ```
   * @type {GatsbyTracing.StartSpan}
   * @example
   * exports.sourceNodes = async ({ actions, tracing }) => {
   *   const span = tracing.startSpan(`foo`)
   *
   *   // Perform any span operations. E.g. add a tag to your span
   *   span.setTag(`bar`, `baz`)
   *
   *   // Rest of your plugin code
   *
   *   span.finish()
   * }
   */
  startSpan: true,
};

/**
 * 名前を指定してキャッシュのインスタンスを取得する。これは、サブプラグインを
 * 受け付けるプラグインだけが使うべきである。
 * @param {string} id ノードの ID
 * @returns {GatsbyCache} [`cache`](#cache) の節を参照。
 */
module.exports.getCache = true;

/**
 * 時間、メモリー、CPU を多く使うタスクの結果を永続化するための
 * キーバリューストア。すべての関数は非同期で、Promise を返す。
 * @type {GatsbyCache}
 */
module.exports.cache = true;

/**
 * 文字列またはオブジェクトから、安定したコンテンツのダイジェストを作成する。
 * この関数の結果は、ノードの `internal.contentDigest` フィールドの
 * 設定に使える。Gatsby はこのフィールドの値を使って、コンテンツが
 * 変わったときに古いデータを無効化する。
 * @param {(string|object)} input
 * @returns {string} ハッシュ文字列
 * @example
 * const node = {
 *   ...nodeData,
 *   internal: {
 *     type: `TypeOfNode`,
 *     contentDigest: createContentDigest(nodeData)
 *   }
 * }
 */
module.exports.createContentDigest = true;

/**
 * Gatsby の内部状態をプログラムから変更するための関数の集まり。
 *
 * [`actions`](/docs/actions/) のリファレンスを参照。
 * @type {Actions}
 */
module.exports.actions = true;

/**
 * ノードを作成したプラグインから、そのノードのコンテンツを取得する。
 * @param {Node} node
 * @returns {Promise<string>}
 * @example
 * module.exports = async function onCreateNode(
 *   { node, loadNodeContent, actions, createNodeId }
 * ) {
 *   if (node.internal.mediaType === 'text/markdown') {
 *     const { createNode, createParentChildLink } = actions
 *     const textContent = await loadNodeContent(node)
 *     // process textContent and create child nodes
 *   }
 * }
 */
module.exports.loadNodeContent = true;

/**
 * アプリケーションの状態に使われる内部の redux の状態。どうしても必要な
 * 場合を除いて使わないこと。Store は非公開 API と見なされ、どのバージョンでも
 * 変わる可能性がある。
 * @type {Redux.Store}
 */
module.exports.store = true;

/**
 * 内部のイベントエミッター / リスナー。どうしても必要な場合を除いて
 * 使わないこと。Emitter は非公開 API と見なされ、どのバージョンでも変わる可能性がある。
 * @type {Emitter}
 */
module.exports.emitter = true;

/**
 * すべてのノードの配列を取得する。
 * @returns {Node[]} ノードの配列。
 * @example
 * const allNodes = getNodes()
 */
module.exports.getNodes = true;

/**
 * 指定した ID のノードを 1 つ取得する。
 * graphql のリゾルバーではこれを使わないこと。
 * [`getNodeAndSavePathDependency`](#getNodeAndSavePathDependency) を参照。
 * @param {string} ID ノードの ID。
 * @returns {Node} 1 つのノードのインスタンス。
 * @example
 * const node = getNode(id)
 */
module.exports.getNode = true;

/**
 * 指定した型のノードの配列を取得する。
 * @param {string} Type ノードの型
 * @returns {Node[]} ノードの配列。
 * @example
 * const markdownNodes = getNodesByType(`MarkdownRemark`)
 */
module.exports.getNodesByType = true;

/**
 * ユーザーへ情報を出力するためのユーティリティ一式
 * @type {GatsbyReporter}
 */
module.exports.reporter = true;

/**
 * 指定した ID のノードを 1 つ取得し、指定したパスに対する依存を作成する。
 * クエリ結果の依存を追跡できるように、graphql のリゾルバーでは `getNode` の
 * 代わりにこれを使うこと。使わないと、ノードが変わっても Gatsby は
 * クエリを再実行せず、クエリ結果が古いままになる。詳しくは
 * [Page -> Node Dependency Tracking](/docs/page-node-dependencies/)
 * を参照。
 * @param {string} ID ノードの ID。
 * @param {string} path ノードのパス。
 * @returns {Node} 1 つのノードのインスタンス。
 */
module.exports.getNodeAndSavePathDependency = true;

/**
 * グローバルに一意で安定したノード ID を生成するのに役立つユーティリティ関数。
 * 同じ入力を使っても、プラグインが異なれば異なる ID を
 * 生成する。
 *
 * @param {string} input
 * @returns {string} UUIDv5 の ID 文字列
 * @example
 * const node = {
 *   id: createNodeId(`${backendData.type}${backendData.id}`),
 *   ...restOfNodeData
 * }
 */
module.exports.createNodeId = true;

/**
 * プラグインにより詳細なトレースを追加できるようにするユーティリティ一式。
 * 詳しくは
 * [Performance tracing](https://www.gatsbyjs.com/docs/performance-tracing)
 * のページを参照。
 * @type {GatsbyTracing}
 */
module.exports.tracing = true;

/**
 * リソースの URL にプレフィックスを付けるために使う。`pathPrefix` は、空文字列か、
 * スラッシュで始まりスラッシュで終わらないパスのどちらかになる。`pathPrefix` は、
 * `gatsby-config.js` で `assetPrefix` と `pathPrefix` の両方を渡した場合は
 * `<assetPrefix>/<pathPrefix>` になる。
 *
 * パスのプレフィックスについて詳しくは、[Adding a Path Prefix](https://www.gatsbyjs.com/docs/how-to/previews-deploys-hosting/path-prefix/)
 * のページを参照。
 * @type {string}
 */
module.exports.pathPrefix = true;

/**
 * これは、`gatsby-config.js` で渡された `pathPrefix` と同じである。
 * `pathPrefix` を渡していない場合は空文字列になる。
 * assetPrefix を使っている場合は、pathPrefix の代わりにこれを使うと、`gatsby-config.js` で設定した文字列を受け取れる。
 * `assetPrefix` は含まれない。
 * @type {string}
 */
module.exports.basePath = true;

/**
 * Gatsby からプラグインへ渡されたスパンを表す tracer のスパン。
 * 詳しくは [opentracing の Span のドキュメント](https://opentracing-javascript.surge.sh/classes/span.html) を参照
 * @type {Opentracing.Span}
 */
module.exports.parentSpan = true;
