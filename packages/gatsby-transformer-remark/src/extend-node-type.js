// unified 関連のパッケージは ESM のみで公開されている。remark プラグインを同期的に適用する必要があるので、
// 動的 import ではなく require で読み込む（対応している Node.js は require で ESM を読み込める）。
const { remark: createRemark } = require(`remark`)
const { selectAll } = require(`unist-util-select`)
const _ = require(`lodash`)
const { visit } = require(`unist-util-visit`)
const { toHast: toHAST } = require(`mdast-util-to-hast`)
const { toHtml: hastToHTML } = require(`hast-util-to-html`)
const { toc: mdastToToc } = require(`mdast-util-toc`)
const { toString: mdastToString } = require(`mdast-util-to-string`)
const { unified } = require(`unified`)
const { default: parse } = require(`remark-parse`)
const { default: stringify } = require(`remark-stringify`)
const { default: english } = require(`retext-english`)
const { default: remark2retext } = require(`remark-retext`)
const { removePosition } = require(`unist-util-remove-position`)
const { raw: hastReparseRaw } = require(`hast-util-raw`)
const { gfmAutolinkLiteral } = require(
  `micromark-extension-gfm-autolink-literal`
)
const { gfmFootnote } = require(`micromark-extension-gfm-footnote`)
const { gfmStrikethrough } = require(`micromark-extension-gfm-strikethrough`)
const { gfmTable } = require(`micromark-extension-gfm-table`)
const { gfmTaskListItem } = require(`micromark-extension-gfm-task-list-item`)
const {
  gfmAutolinkLiteralFromMarkdown,
  gfmAutolinkLiteralToMarkdown,
} = require(`mdast-util-gfm-autolink-literal`)
const { gfmFootnoteFromMarkdown, gfmFootnoteToMarkdown } = require(
  `mdast-util-gfm-footnote`
)
const { gfmStrikethroughFromMarkdown, gfmStrikethroughToMarkdown } = require(
  `mdast-util-gfm-strikethrough`
)
const { gfmTableFromMarkdown, gfmTableToMarkdown } = require(
  `mdast-util-gfm-table`
)
const { gfmTaskListItemFromMarkdown, gfmTaskListItemToMarkdown } = require(
  `mdast-util-gfm-task-list-item`
)
const prune = require(`underscore.string/prune`)
const { getConcatenatedValue, cloneTreeUntil, findLastTextNode } = require(
  `./hast-processing`
)
const codeHandler = require(`./code-handler`)
const { getHeadingID } = require(`./utils/get-heading-id`)
const { timeToRead } = require(`./utils/time-to-read`)

// remark-gfm 4 は脚注を必ず含み、`gfm` と `footnotes` のオプションを別々に切り替えられない。
// そのため remark-gfm は使わず、remark-gfm が内部で使っている拡張をオプションに応じて個別に登録する。
function addGfmParts(processor, { gfm, footnotes }) {
  const data = processor.data()
  const add = (field, value) => {
    data[field] = (data[field] || []).concat(value)
  }

  if (gfm) {
    add(`micromarkExtensions`, [
      gfmAutolinkLiteral(),
      gfmStrikethrough(),
      gfmTable(),
      gfmTaskListItem(),
    ])
    add(`fromMarkdownExtensions`, [
      gfmAutolinkLiteralFromMarkdown(),
      gfmStrikethroughFromMarkdown(),
      gfmTableFromMarkdown(),
      gfmTaskListItemFromMarkdown(),
    ])
    add(`toMarkdownExtensions`, [
      gfmAutolinkLiteralToMarkdown(),
      gfmStrikethroughToMarkdown(),
      gfmTableToMarkdown(),
      gfmTaskListItemToMarkdown(),
    ])
  }

  if (footnotes) {
    add(`micromarkExtensions`, gfmFootnote())
    add(`fromMarkdownExtensions`, gfmFootnoteFromMarkdown())
    add(`toMarkdownExtensions`, gfmFootnoteToMarkdown())
  }
}

let fileNodes
let pluginsCacheStr = ``
let pathPrefixCacheStr = ``

const CACHE_TYPE_AST = `ast`
const CACHE_TYPE_HTMLAST = `html-ast`
const CACHE_TYPE_HTML = `html`
const CACHE_TYPE_HEADINGS = `headings`
const CACHE_TYPE_TOC = `toc`
const CACHE_TYPE_NODE_DEPS = `node-dependencies`

const cacheTypesWithOptions = [CACHE_TYPE_TOC]
const cacheTypesUsingNodeId = [CACHE_TYPE_NODE_DEPS]

const getCacheKey = (cacheType, node, options = {}) => {
  const keyVars = [
    cacheTypesUsingNodeId.indexOf(cacheType) >= 0
      ? node.id
      : node.internal.contentDigest,
    pluginsCacheStr,
    pathPrefixCacheStr,
  ]

  if (cacheTypesWithOptions.indexOf(cacheType) >= 0) {
    keyVars.push(JSON.stringify(options))
  }

  return `transformer-remark-markdown-${cacheType}-${keyVars.join(`-`)}`
}

// 新しい URL で `/` が 1 つだけになるようにする
const withPathPrefix = (url, pathPrefix) =>
  (pathPrefix + url).replace(/\/\//, `/`)

/**
 * AST の生成状況を記録する Map。並行して何度も生成しないように
 * するためである。
 *
 * @type {Map<string,Promise>}
 */
const ASTPromiseMap = new Map()

/**
 * Markdown のノードタイプのうち、出現したときにテキストを区切るための
 * 余分な空白を生成するものすべての Set。
 *
 * @type {Set<string>}
 */
const SpaceMarkdownNodeTypesSet = new Set([
  `paragraph`,
  `heading`,
  `tableCell`,
  `break`,
])

const headingLevels = [...Array(6).keys()].reduce((acc, i) => {
  acc[`h${i}`] = i
  return acc
}, {})

module.exports = function remarkExtendNodeType(
  {
    type,
    basePath,
    getNode,
    getNodesByType,
    cache,
    getCache,
    reporter,
    ...rest
  },
  pluginOptions
) {
  if (type.name !== `MarkdownRemark`) {
    return {}
  }
  pluginsCacheStr = pluginOptions.plugins.map(p => p.name).join(``)
  pathPrefixCacheStr = basePath || ``

  return new Promise((resolve, reject) => {
    // Remark をセットアップする。
    const {
      blocks,
      footnotes = true,
      gfm = true,
      tableOfContents = {
        heading: null,
        maxDepth: 6,
      },
    } = pluginOptions
    const tocOptions = tableOfContents
    const remarkOptions = {}

    if (_.isArray(blocks)) {
      remarkOptions.blocks = blocks
    }

    let remark = createRemark().data(`settings`, remarkOptions)

    if (gfm || footnotes) {
      // TODO: `gfm` と `footnotes` のオプションを非推奨にして、remark-gfm を明示的にプラグインとして使う形にする？
      addGfmParts(remark, { gfm, footnotes })
    }

    for (const plugin of pluginOptions.plugins) {
      const requiredPlugin = plugin.module
      if (_.isFunction(requiredPlugin.setParserPlugins)) {
        for (const parserPlugin of requiredPlugin.setParserPlugins(
          plugin.pluginOptions
        )) {
          if (_.isArray(parserPlugin)) {
            const [parser, options] = parserPlugin
            remark = remark.use(parser, options)
          } else {
            remark = remark.use(parserPlugin)
          }
        }
      }
    }

    async function getFileWithNodeDependencyTracking(
      inMemoryNodeDependencyCache,
      context,
      markdownNode,
      queryFilter
    ) {
      const depNode = await context.nodeModel.findOne({
        query: {
          filter: queryFilter,
        },
        type: `File`,
      })

      // 見つからない場合は、findOne の結果をそのまま返す
      if (!depNode) {
        return depNode
      }

      // インメモリーのキャッシュを使って、markdownNode の現在の依存関係を取得する
      // 並行して動く remark プラグインの間で上書きしないようにするためである
      const depCacheKey = getCacheKey(CACHE_TYPE_NODE_DEPS, markdownNode)
      const dependencies = inMemoryNodeDependencyCache

      if (dependencies[depNode.id] !== depNode.internal.contentDigest) {
        dependencies[depNode.id] = depNode.internal.contentDigest
        await cache.set(depCacheKey, dependencies)
      }

      return depNode
    }

    async function getCacheWithNodeDependencyValidation(
      cacheKey,
      markdownNode,
      context
    ) {
      const depCacheKey = getCacheKey(CACHE_TYPE_NODE_DEPS, markdownNode)
      const dependencies = await cache.get(depCacheKey)

      if (dependencies && context) {
        for (const depNodeId of Object.keys(dependencies)) {
          // 現在の contentDigest を取得する
          const depNode = context.nodeModel.getNodeById({
            id: depNodeId,
            type: `File`,
          })

          if (!depNode) {
            // depNode が見つからなかった。おそらく削除されている
            // 依存関係を対応付け直せるよう、キャッシュを無効化する
            return undefined
          }

          const curDepDigest = depNode.internal.contentDigest
          const prevDepDigest = dependencies[depNodeId]

          // contentDigest が一致しない場合は、キャッシュを無効化する
          // これにより depNodes の確認も行われるので、ここで設定する必要はない
          if (prevDepDigest !== curDepDigest) {
            return undefined
          }
        }
      }

      const cachedValue = await cache.get(cacheKey)
      return cachedValue
    }

    async function getAST(markdownNode, context) {
      const cacheKey = getCacheKey(CACHE_TYPE_AST, markdownNode)

      const promise = ASTPromiseMap.get(cacheKey)
      if (promise) {
        // すでに AST を生成中なので、それを待つ
        return promise
      }

      const cachedAST = await getCacheWithNodeDependencyValidation(
        cacheKey,
        markdownNode,
        context
      )
      if (cachedAST) {
        return cachedAST
      }

      const ASTGenerationPromise = getMarkdownAST(markdownNode, context)
      ASTPromiseMap.set(cacheKey, ASTGenerationPromise)

      // 結果が正常であればキャッシュする promise を返す。いずれの場合も、promise はローカルキャッシュから削除される
      // Note: 別のパースでこのキャッシュにヒットした場合は、キャッシュを待つ必要がない
      try {
        const markdownAST = await ASTGenerationPromise

        await cache.set(cacheKey, markdownAST)

        return markdownAST
      } finally {
        ASTPromiseMap.delete(cacheKey)
      }
    }

    // markdown の文字列とその AST 表現をパースし、必要に応じて remark プラグインを適用する
    async function parseString(string, markdownNode, context) {
      // remark プラグインに注入するコンパイラー
      // これにより、プラグインはユーザーのすべてのオプションとプラグインを
      // 反映したパーサーとジェネレーターを使える
      const compiler = {
        parseString: string => parseString(string, markdownNode, context),
        generateHTML: ast =>
          hastToHTML(markdownASTToHTMLAst(ast), {
            allowDangerousHtml: true,
          }),
      }

      const markdownAST = remark.parse(string)

      if (basePath) {
        // 相対リンクに `pathPrefix` が含まれるようにする
        visit(markdownAST, [`link`, `definition`], node => {
          if (
            node.url &&
            node.url.startsWith(`/`) &&
            !node.url.startsWith(`//`)
          ) {
            node.url = withPathPrefix(node.url, basePath)
          }
        })
      }

      if (process.env.NODE_ENV !== `production` || !fileNodes) {
        fileNodes = getNodesByType(`File`)
      }

      // ある markDown ノードの依存関係を追跡するために使う
      // markdown の内容が変わらなくても、依存先が変われば
      // 再ビルドできるようにする。複数のプロセスがこの値を上書きしないよう、
      // ここではローカルキャッシュのコピーを使う。
      // type {[depNodeId: string]: string}
      const inMemoryNodeDependencyCache = {}

      // remark プラグインを直列に実行するため、for ループを使う。
      for (const plugin of pluginOptions.plugins) {
        const requiredPlugin = plugin.module

        // exports = function() と exports.default = function() の両方を許可する
        const defaultFunction = _.isFunction(requiredPlugin)
          ? requiredPlugin
          : _.isFunction(requiredPlugin.default)
            ? requiredPlugin.default
            : undefined

        if (defaultFunction) {
          await defaultFunction(
            {
              markdownAST,
              markdownNode,
              getNode,
              getNodesByType,
              files: fileNodes,
              basePath,
              reporter,
              cache: getCache(plugin.name),
              getCache,
              compiler,
              context,
              getRemarkFileDependency: queryFilter =>
                getFileWithNodeDependencyTracking(
                  inMemoryNodeDependencyCache,
                  context,
                  markdownNode,
                  queryFilter
                ),
              ...rest,
            },
            plugin.pluginOptions
          )
        }
      }

      // この markdownNode の依存関係のキャッシュをセットアップする
      const depCacheKey = getCacheKey(CACHE_TYPE_NODE_DEPS, markdownNode)
      await cache.set(depCacheKey, inMemoryNodeDependencyCache)

      return markdownAST
    }

    async function getMarkdownAST(markdownNode, context = undefined) {
      if (process.env.NODE_ENV !== `production` || !fileNodes) {
        fileNodes = getNodesByType(`File`)
      }

      // 内容をパースする前に、ノードを変更しうる
      // remark プラグインを実行する
      //
      // remark プラグインを直列に実行するため、for ループを使う。
      for (const plugin of pluginOptions.plugins) {
        const requiredPlugin = plugin.module

        if (typeof requiredPlugin.mutateSource === `function`) {
          await requiredPlugin.mutateSource(
            {
              markdownNode,
              files: fileNodes,
              getNode,
              reporter,
              cache: getCache(plugin.name),
              getCache,
              ...rest,
            },
            plugin.pluginOptions
          )
        }
      }

      return parseString(markdownNode.internal.content, markdownNode, context)
    }

    async function getHeadings(markdownNode, context) {
      const markdownCacheKey = getCacheKey(CACHE_TYPE_HEADINGS, markdownNode)
      const cachedHeadings = await getCacheWithNodeDependencyValidation(
        markdownCacheKey,
        markdownNode,
        context
      )
      if (cachedHeadings) {
        return cachedHeadings
      }

      const ast = await getAST(markdownNode, context)
      const headings = selectAll(`heading`, ast).map(heading => {
        return {
          id: getHeadingID(heading),
          value: mdastToString(heading),
          depth: heading.depth,
        }
      })

      await cache.set(markdownCacheKey, headings)
      return headings
    }

    function addSlugToUrl(markdownNode, slugField, appliedTocOptions, node) {
      if (node.url) {
        if (slugField === undefined) {
          console.warn(
            `Skipping TableOfContents. Field '${appliedTocOptions.pathToSlugField}' missing from markdown node`
          )
          return null
        }

        node.url = [basePath, slugField, node.url]
          .join(`/`)
          .replace(/\/\//g, `/`)
      }

      if (node.children) {
        node.children = node.children
          .map(node =>
            addSlugToUrl(markdownNode, slugField, appliedTocOptions, node)
          )
          .filter(Boolean)
      }

      return node
    }

    async function getTableOfContents(markdownNode, gqlTocOptions, context) {
      // デフォルト値を取得する
      const appliedTocOptions = { ...tocOptions, ...gqlTocOptions }

      const tocKey = getCacheKey(
        CACHE_TYPE_TOC,
        markdownNode,
        appliedTocOptions
      )

      // キャッシュ済みの toc を取得する
      const cachedToc = await getCacheWithNodeDependencyValidation(
        tocKey,
        markdownNode,
        context
      )
      if (cachedToc) {
        return cachedToc
      }

      const ast = await getAST(markdownNode, context)
      const tocAst = mdastToToc(ast, appliedTocOptions)

      let toc = ``
      if (tocAst.map) {
        if (appliedTocOptions.absolute) {
          const slugField = _.get(
            markdownNode,
            appliedTocOptions.pathToSlugField
          )

          tocAst.map = addSlugToUrl(
            markdownNode,
            slugField,
            appliedTocOptions,
            tocAst.map
          )
        }

        // addSlugToUrl が map を消去することがある
        if (tocAst.map) {
          toc = hastToHTML(toHAST(tocAst.map, { allowDangerousHtml: true }), {
            allowDangerousHtml: true,
          })
        }
      }

      await cache.set(tocKey, toc)
      return toc
    }

    function markdownASTToHTMLAst(ast) {
      return toHAST(ast, {
        allowDangerousHtml: true,
        // 脚注の id を、これまでと同じ `fn-1` `fnref-1` の形にする（既定では `user-content-` が前に付く）
        clobberPrefix: ``,
        handlers: { code: codeHandler },
      })
    }

    async function getHTMLAst(markdownNode, context) {
      const key = getCacheKey(CACHE_TYPE_HTMLAST, markdownNode)
      const cachedAst = await getCacheWithNodeDependencyValidation(
        key,
        markdownNode,
        context
      )
      if (cachedAst) {
        return cachedAst
      } else {
        const ast = await getAST(markdownNode, context)
        const htmlAst = markdownASTToHTMLAst(ast)

        // 新しい HTML AST をキャッシュに保存して返す
        await cache.set(key, htmlAst)
        return htmlAst
      }
    }

    async function getHTML(markdownNode, context) {
      const cacheKey = getCacheKey(CACHE_TYPE_HTML, markdownNode)
      const cachedHTML = await getCacheWithNodeDependencyValidation(
        cacheKey,
        markdownNode,
        context
      )
      if (cachedHTML) {
        return cachedHTML
      } else {
        const ast = await getHTMLAst(markdownNode, context)
        // 新しい HTML をキャッシュに保存して返す
        const html = hastToHTML(ast, {
          allowDangerousHtml: true,
        })

        // 新しい HTML をキャッシュに保存する
        await cache.set(cacheKey, html)

        return html
      }
    }

    async function getExcerptAst(
      fullAST,
      markdownNode,
      { pruneLength, truncate, excerptSeparator }
    ) {
      if (excerptSeparator && markdownNode.excerpt !== ``) {
        return cloneTreeUntil(
          fullAST,
          ({ nextNode }) =>
            nextNode.type === `raw` && nextNode.value === excerptSeparator
        )
      }

      if (!fullAST.children.length) {
        return fullAST
      }

      const excerptAST = cloneTreeUntil(fullAST, ({ root }) => {
        const totalExcerptSoFar = getConcatenatedValue(root)
        return totalExcerptSoFar && totalExcerptSoFar.length > pruneLength
      })
      const unprunedExcerpt = getConcatenatedValue(excerptAST)

      if (
        !unprunedExcerpt ||
        (pruneLength && unprunedExcerpt.length < pruneLength)
      ) {
        return excerptAST
      }

      const lastTextNode = findLastTextNode(excerptAST)
      const amountToPruneBy = unprunedExcerpt.length - pruneLength
      const desiredLengthOfLastNode =
        lastTextNode.value.length - amountToPruneBy
      if (!truncate) {
        lastTextNode.value = prune(
          lastTextNode.value,
          desiredLengthOfLastNode,
          `…`
        )
      } else {
        lastTextNode.value = _.truncate(lastTextNode.value, {
          length: pruneLength,
          omission: `…`,
        })
      }

      return excerptAST
    }

    async function getExcerptHtml(
      markdownNode,
      pruneLength,
      truncate,
      excerptSeparator,
      context
    ) {
      const fullAST = await getHTMLAst(markdownNode, context)
      const excerptAST = await getExcerptAst(fullAST, markdownNode, {
        pruneLength,
        truncate,
        excerptSeparator,
      })

      return hastToHTML(excerptAST, {
        allowDangerousHtml: true,
      })
    }

    async function getExcerptMarkdown(
      markdownNode,
      pruneLength,
      truncate,
      excerptSeparator
    ) {
      // オプションに excerptSeparator があり、内容にも excerptSeparator が含まれていれば、grayMatter から抜粋が得られるので、それを使える
      if (excerptSeparator && markdownNode.excerpt !== ``) {
        return markdownNode.excerpt
      }

      const ast = await getMarkdownAST(markdownNode)
      const excerptAST = await getExcerptAst(ast, markdownNode, {
        pruneLength,
        truncate,
        excerptSeparator,
      })

      // remark-stringify 9 の既定値と同じ書式（インデントのコードブロック、タブ幅のリスト）で出力する
      return unified()
        .use(stringify, { fences: false, listItemIndent: `tab` })
        .stringify(excerptAST)
    }

    async function getExcerptPlain(
      markdownNode,
      pruneLength,
      truncate,
      excerptSeparator,
      context
    ) {
      const ast = await getAST(markdownNode, context)

      const excerptNodes = []
      let isBeforeSeparator = true
      visit(
        ast,
        node => isBeforeSeparator,
        node => {
          if (excerptSeparator && node.value === excerptSeparator) {
            isBeforeSeparator = false
          } else if (node.type === `text` || node.type === `inlineCode`) {
            excerptNodes.push(node.value)
          } else if (node.type === `image`) {
            excerptNodes.push(node.alt)
          } else if (SpaceMarkdownNodeTypesSet.has(node.type)) {
            // これらのノードタイプのいずれかが出現したら、空白を追加する。
            excerptNodes.push(` `)
          }
        }
      )

      const excerptText = excerptNodes.join(``).trim()

      if (excerptSeparator && !isBeforeSeparator) {
        return excerptText
      }

      if (!truncate) {
        return prune(excerptText, pruneLength, `…`)
      }

      return _.truncate(excerptText, {
        length: pruneLength,
        omission: `…`,
      })
    }

    async function getExcerpt(
      markdownNode,
      { format, pruneLength, truncate, excerptSeparator },
      context
    ) {
      if (format === `HTML`) {
        return getExcerptHtml(
          markdownNode,
          pruneLength,
          truncate,
          excerptSeparator,
          context
        )
      }

      if (format === `MARKDOWN`) {
        return getExcerptMarkdown(
          markdownNode,
          pruneLength,
          truncate,
          excerptSeparator,
          context
        )
      }

      return getExcerptPlain(
        markdownNode,
        pruneLength,
        truncate,
        excerptSeparator,
        context
      )
    }

    return resolve({
      html: {
        type: `String`,
        async resolve(markdownNode, opt, context) {
          return getHTML(markdownNode, context)
        },
      },
      htmlAst: {
        type: `JSON`,
        async resolve(markdownNode, opt, context) {
          const ast = await getHTMLAst(markdownNode, context)
          const strippedAst = _.clone(ast)
          removePosition(strippedAst, { force: true })
          return hastReparseRaw(strippedAst)
        },
      },
      excerpt: {
        type: `String`,
        args: {
          pruneLength: {
            type: `Int`,
            defaultValue: 140,
          },
          truncate: {
            type: `Boolean`,
            defaultValue: false,
          },
          format: {
            type: `MarkdownExcerptFormats`,
            defaultValue: `PLAIN`,
          },
        },
        resolve(markdownNode, { format, pruneLength, truncate }, context) {
          return getExcerpt(
            markdownNode,
            {
              format,
              pruneLength,
              truncate,
              excerptSeparator: pluginOptions.excerpt_separator,
            },
            context
          )
        },
      },
      excerptAst: {
        type: `JSON`,
        args: {
          pruneLength: {
            type: `Int`,
            defaultValue: 140,
          },
          truncate: {
            type: `Boolean`,
            defaultValue: false,
          },
        },
        async resolve(markdownNode, { pruneLength, truncate }, context) {
          const fullAST = await getHTMLAst(markdownNode, context)
          const ast = await getExcerptAst(fullAST, markdownNode, {
            pruneLength,
            truncate,
            excerptSeparator: pluginOptions.excerpt_separator,
          })
          const strippedAst = _.clone(ast)
          removePosition(strippedAst, { force: true })
          return hastReparseRaw(strippedAst)
        },
      },
      headings: {
        type: [`MarkdownHeading`],
        args: {
          depth: `MarkdownHeadingLevels`,
        },
        async resolve(markdownNode, { depth }, context) {
          let headings = await getHeadings(markdownNode, context)
          const level = depth && headingLevels[depth]
          if (typeof level === `number`) {
            headings = headings.filter(heading => heading.depth === level)
          }
          return headings
        },
      },
      timeToRead: {
        type: `Int`,
        async resolve(markdownNode, opt, context) {
          const r = await getHTML(markdownNode, context)
          return timeToRead(r)
        },
      },
      tableOfContents: {
        type: `String`,
        args: {
          absolute: {
            type: `Boolean`,
            defaultValue: false,
          },
          pathToSlugField: {
            type: `String`,
            defaultValue: ``,
          },
          maxDepth: `Int`,
          heading: `String`,
        },
        resolve(markdownNode, args, context) {
          return getTableOfContents(markdownNode, args, context)
        },
      },
      // TODO: 非ラテン系の言語への対応を追加する https://github.com/wooorm/remark/issues/251#issuecomment-296731071
      wordCount: {
        type: `MarkdownWordCount`,
        async resolve(markdownNode) {
          const counts = {}

          // remark-retext 6 は retext 側のプロセッサーを非同期に実行するので、processSync は使えない
          await unified()
            .use(parse)
            .use(remark2retext, unified().use(english).use(count))
            .use(stringify)
            .process(markdownNode.internal.content)

          return {
            paragraphs: counts.ParagraphNode,
            sentences: counts.SentenceNode,
            words: counts.WordNode,
          }

          function count() {
            return counter
            function counter(tree) {
              visit(tree, visitor)
              function visitor(node) {
                counts[node.type] = (counts[node.type] || 0) + 1
              }
            }
          }
        },
      },
    })
  })
}
