const got = require(`got`)
const _ = require(`lodash`)
const urlJoin = require(`url-join`)
import HttpAgent from "agentkeepalive"

// const http2wrapper = require(`http2-wrapper`)
const opentracing = require(`opentracing`)
const { SemanticAttributes } = require(`@opentelemetry/semantic-conventions`)

const {
  polyfillImageServiceDevRoutes,
  addRemoteFilePolyfillInterface,
} = require(`gatsby-plugin-utils/polyfill-remote-file`)

const { HttpsAgent } = HttpAgent

const { setOptions, getOptions } = require(`./plugin-options`)

import {
  nodeFromData,
  downloadFile,
  isFileNode,
  imageCDNState,
  generateTypeName,
} from "./normalize"

import {
  handleReferences,
  handleWebhookUpdate,
  createNodeIfItDoesNotExist,
  handleDeletedNode,
  drupalCreateNodeManifest,
  getExtendedFileNodeData,
} from "./utils"
const imageCdnDocs = `https://github.com/gatsbyjs/gatsby/tree/master/packages/gatsby-source-drupal#readme`

const agent = {
  http: new HttpAgent(),
  https: new HttpsAgent(),
  // http2: new http2wrapper.Agent(),
}

let start
let apiRequestCount = 0
let initialSourcing = true
let globalReporter
async function worker([url, options]) {
  const tracer = opentracing.globalTracer()
  const httpSpan = tracer.startSpan(`http.get`, {
    childOf: options.parentSpan,
  })
  const parsedUrl = new URL(url)
  httpSpan.setTag(SemanticAttributes.HTTP_URL, url)
  httpSpan.setTag(SemanticAttributes.HTTP_HOST, parsedUrl.host)
  httpSpan.setTag(
    SemanticAttributes.HTTP_SCHEME,
    parsedUrl.protocol.replace(/:$/, ``)
  )
  httpSpan.setTag(SemanticAttributes.HTTP_TARGET, parsedUrl.pathname)
  httpSpan.setTag(`plugin`, `gatsby-source-drupal`)

  // 最初のソーシング中に進捗をログに出力する。
  if (initialSourcing) {
    apiRequestCount += 1
    if (!start) {
      start = Date.now()
    }
    const queueLength = requestQueue.length()
    if (apiRequestCount % 50 === 0) {
      globalReporter.verbose(
        `gatsby-source-drupal has ${queueLength} API requests queued and the current request rate is ${(
          apiRequestCount /
          ((Date.now() - start) / 1000)
        ).toFixed(2)} requests / second`
      )
    }
  }

  if (typeof options.searchParams === `object`) {
    url = new URL(url)
    const searchParams = new URLSearchParams(options.searchParams)
    const searchKeys = Array.from(searchParams.keys())
    searchKeys.forEach(searchKey => {
      // 検索パラメーターは、まだ追加されていない場合にだけ
      // URL に追加する。
      if (!url.searchParams.has(searchKey)) {
        url.searchParams.set(searchKey, searchParams.get(searchKey))
      }
    })
    url = url.toString()
  }
  delete options.searchParams

  const response = await got(url, {
    agent,
    cache: false,
    // request: http2wrapper.auto,
    // http2: true,
    ...options,
  })

  httpSpan.setTag(SemanticAttributes.HTTP_STATUS_CODE, response?.statusCode)
  httpSpan.setTag(SemanticAttributes.HTTP_METHOD, `GET`)
  httpSpan.setTag(SemanticAttributes.NET_PEER_IP, response?.ip)
  httpSpan.setTag(
    SemanticAttributes.HTTP_RESPONSE_CONTENT_LENGTH,
    response?.rawBody?.length
  )

  httpSpan.finish()

  return response
}

const requestQueue = require(`fastq`).promise(worker, 20)

const asyncPool = require(`tiny-async-pool`)
const bodyParser = require(`body-parser`)

function gracefullyRethrow(activity, error) {
  // activity.panicOnBuild は gatsby@2 の途中で実装されたが、
  // このプラグインはそれより古いバージョンの gatsby コアでも使えるので、
  // ここで確認が必要になる
  if (activity.panicOnBuild) {
    activity.panicOnBuild(error)
  }

  activity.end()

  if (!activity.panicOnBuild) {
    throw error
  }
}

exports.onPreBootstrap = ({ actions }, pluginOptions) => {
  setOptions(pluginOptions)

  if (typeof actions?.addRemoteFileAllowedUrl === `function`) {
    actions.addRemoteFileAllowedUrl(urlJoin(pluginOptions.baseUrl, `*`))
  }
}

exports.sourceNodes = async (
  {
    actions,
    store,
    cache,
    createNodeId,
    createContentDigest,
    getCache,
    getNode,
    getNodes,
    parentSpan,
    reporter,
    webhookBody,
  },
  pluginOptions
) => {
  const tracer = opentracing.globalTracer()

  globalReporter = reporter
  const {
    baseUrl,
    proxyUrl = baseUrl,
    apiBase = `jsonapi`,
    basicAuth = {},
    filters,
    headers,
    params = {},
    concurrentFileRequests = 20,
    concurrentAPIRequests = 20,
    requestTimeoutMS,
    disallowedLinkTypes = [
      `self`,
      `describedby`,
      `contact_message--feedback`,
      `contact_message--personal`,
    ],
    skipFileDownloads = false,
    fastBuilds = false,
    entityReferenceRevisions = [],
    languageConfig = {
      filterByLanguages: false,
      defaultLanguage: `und`,
      enabledLanguages: [`und`],
      translatableEntities: [],
      nonTranslatableEntities: [],
    },
  } = pluginOptions

  // 古いバージョンの Gatsby は、プラグインオプションに Joi のデフォルト値を使っていなかった
  if (!(`imageCDN` in pluginOptions)) {
    pluginOptions.imageCDN = true
  }

  const {
    createNode,
    setPluginStatus,
    touchNode,
    unstable_createNodeManifest,
  } = actions
  // プラグインオプションから同時実行数の上限を更新する
  requestQueue.concurrency = concurrentAPIRequests

  if (webhookBody && Object.keys(webhookBody).length) {
    const changesActivity = reporter.activityTimer(
      `loading Drupal content changes`,
      {
        parentSpan,
      }
    )
    changesActivity.start()

    try {
      const { secret, action, data } = webhookBody
      if (pluginOptions.secret && pluginOptions.secret !== secret) {
        reporter.warn(
          `The secret in this request did not match your plugin options secret.`
        )
        changesActivity.end()
        return
      }

      if (!action || !data) {
        reporter.warn(
          `The webhook body was malformed

${JSON.stringify(webhookBody, null, 4)}`
        )

        changesActivity.end()
        return
      }

      if (action === `delete`) {
        let nodesToDelete = data
        if (!Array.isArray(data)) {
          nodesToDelete = [data]
        }

        for (const nodeToDelete of nodesToDelete) {
          const deletedNode = await handleDeletedNode({
            actions,
            getNode,
            cache,
            node: nodeToDelete,
            createNodeId,
            createContentDigest,
            entityReferenceRevisions,
            pluginOptions,
          })
          reporter.log(`Deleted node: ${deletedNode.id}`)
        }

        changesActivity.end()
        return
      }

      let nodesToUpdate = data
      if (!Array.isArray(data)) {
        nodesToUpdate = [data]
      }

      for (const nodeToUpdate of nodesToUpdate) {
        await createNodeIfItDoesNotExist({
          nodeToUpdate,
          actions,
          createNodeId,
          createContentDigest,
          getNode,
          reporter,
          pluginOptions,
        })
      }

      for (const nodeToUpdate of nodesToUpdate) {
        await handleWebhookUpdate(
          {
            nodeToUpdate,
            actions,
            cache,
            createNodeId,
            createContentDigest,
            getCache,
            getNode,
            reporter,
          },
          pluginOptions
        )
      }
    } catch (e) {
      gracefullyRethrow(changesActivity, e)
      return
    }
    changesActivity.end()
    return
  }

  if (fastBuilds) {
    const fastBuildsSpan = tracer.startSpan(`sourceNodes.fetch`, {
      childOf: parentSpan,
    })
    fastBuildsSpan.setTag(`plugin`, `gatsby-source-drupal`)
    fastBuildsSpan.setTag(`sourceNodes.fetch.type`, `delta`)

    const lastFetched =
      store.getState().status.plugins?.[`gatsby-source-drupal`]?.lastFetched

    reporter.verbose(
      `[gatsby-source-drupal]: value of lastFetched for fastbuilds "${lastFetched}"`
    )

    let requireFullRebuild = false

    // lastFetched が設定されていないので、フルリビルドを行う。
    if (!lastFetched) {
      setPluginStatus({ lastFetched: Math.floor(new Date().getTime() / 1000) })
      requireFullRebuild = true
    } else {
      const drupalFetchIncrementalActivity = reporter.activityTimer(
        `Fetch incremental changes from Drupal`,
        { parentSpan: fastBuildsSpan }
      )

      drupalFetchIncrementalActivity.start()

      try {
        // lastFetched の日時を付けて fastbuilds のエンドポイントにアクセスする。
        const res = await requestQueue.push([
          urlJoin(
            baseUrl,
            `gatsby-fastbuilds/sync/`,
            Math.floor(lastFetched).toString()
          ),
          {
            username: basicAuth.username,
            password: basicAuth.password,
            headers,
            searchParams: params,
            responseType: `json`,
            parentSpan: fastBuildsSpan,
            timeout: {
              // Drupal へのリクエストは、ときどき止まることがある。その場合にリトライできるよう、（デフォルトで）30 秒のタイムアウトを設定する。
              request: requestTimeoutMS,
            },
          },
        ])

        // Fastbuilds は次の場合に -1 を返す:
        // - タイムスタンプの期限が切れている
        // - 古い fastbuild のログが削除された
        // - 前回の同期からかなり時間がたっているので、フルフェッチを行うことになる。
        if (res.body.status === -1) {
          // 差分データの期限が切れているか、これが最初の取得である。
          reporter.info(`Unable to pull incremental data changes from Drupal`)
          setPluginStatus({ lastFetched: res.body.timestamp })
          requireFullRebuild = true
        } else {
          // Gatsby にガベージコレクションされないよう、ノードを touch する。
          if (initialSourcing) {
            const touchNodesSpan = tracer.startSpan(`sourceNodes.touchNodes`, {
              childOf: fastBuildsSpan,
            })
            touchNodesSpan.setTag(`plugin`, `gatsby-source-drupal`)
            let touchCount = 0
            getNodes().forEach(node => {
              if (node.internal.owner === `gatsby-source-drupal`) {
                touchCount += 1
                touchNode(node)
              }
            })
            touchNodesSpan.setTag(`sourceNodes.touchNodes.count`, touchCount)
            touchNodesSpan.finish()
          }

          const createNodesSpan = tracer.startSpan(`sourceNodes.createNodes`, {
            childOf: parentSpan,
          })
          createNodesSpan.setTag(`plugin`, `gatsby-source-drupal`)
          createNodesSpan.setTag(`sourceNodes.fetch.type`, `delta`)
          createNodesSpan.setTag(
            `sourceNodes.createNodes.count`,
            res.body.entities?.length
          )

          // Drupal からの同期データを処理する。
          const nodesToSync = res.body.entities

          // まず、これまでに見たことのないノードをすべて作成する。こうしておけば、
          // ノードが Gatsby に存在する状態になるので、次にリレーションシップを
          // 正しく作成できる。
          for (const nodeSyncData of nodesToSync) {
            if (nodeSyncData.action === `delete`) {
              continue
            }

            let nodesToUpdate = nodeSyncData.data
            if (!Array.isArray(nodeSyncData.data)) {
              nodesToUpdate = [nodeSyncData.data]
            }
            for (const nodeToUpdate of nodesToUpdate) {
              await createNodeIfItDoesNotExist({
                nodeToUpdate,
                actions,
                createNodeId,
                createContentDigest,
                getNode,
                reporter,
                pluginOptions,
              })
            }
          }

          for (const nodeSyncData of nodesToSync) {
            if (nodeSyncData.action === `delete`) {
              await handleDeletedNode({
                actions,
                getNode,
                cache,
                node: nodeSyncData,
                createNodeId,
                createContentDigest,
                entityReferenceRevisions,
                pluginOptions,
              })
            } else {
              // データは、更新対象の Drupal エンティティ 1 つのことも、Drupal エンティティの
              // 配列のこともある。
              let nodesToUpdate = nodeSyncData.data
              if (!Array.isArray(nodeSyncData.data)) {
                nodesToUpdate = [nodeSyncData.data]
              }

              for (const nodeToUpdate of nodesToUpdate) {
                await handleWebhookUpdate(
                  {
                    nodeToUpdate,
                    actions,
                    cache,
                    createNodeId,
                    createContentDigest,
                    getCache,
                    getNode,
                    reporter,
                  },
                  pluginOptions
                )
              }
            }
          }

          createNodesSpan.finish()
          setPluginStatus({ lastFetched: res.body.timestamp })
        }
      } catch (e) {
        gracefullyRethrow(drupalFetchIncrementalActivity, e)

        drupalFetchIncrementalActivity.end()
        fastBuildsSpan.finish()
        return
      }

      drupalFetchIncrementalActivity.end()
      fastBuildsSpan.finish()

      // これで、最初の（fastbuilds を使った）ソーシングは完了である。
      initialSourcing = false

      if (!requireFullRebuild) {
        return
      }
    }
  }

  const drupalFetchActivity = reporter.activityTimer(
    `Fetch all data from Drupal`,
    { parentSpan }
  )
  const fullFetchSpan = tracer.startSpan(`sourceNodes.fetch`, {
    childOf: parentSpan,
  })
  fullFetchSpan.setTag(`plugin`, `gatsby-source-drupal`)
  fullFetchSpan.setTag(`sourceNodes.fetch.type`, `full`)

  // 記事を取得する。
  reporter.info(`Starting to fetch all data from Drupal`)

  drupalFetchActivity.start()

  let allData
  const typeRequestsQueued = new Set()
  try {
    const res = await requestQueue.push([
      urlJoin(baseUrl, apiBase),
      {
        username: basicAuth.username,
        password: basicAuth.password,
        headers,
        searchParams: params,
        responseType: `json`,
        parentSpan: fullFetchSpan,
        timeout: {
          // Drupal へのリクエストは、ときどき止まることがある。その場合にリトライできるよう、（デフォルトで）30 秒のタイムアウトを設定する。
          request: requestTimeoutMS,
        },
      },
    ])
    allData = await Promise.all(
      _.map(res.body.links, async (url, type) => {
        const dataArray = []
        if (disallowedLinkTypes.includes(type)) return
        if (!url) return
        if (!type) return

        // 言語を切り替えられるエンティティの一覧から、この型を探す。
        const isTranslatable = languageConfig.translatableEntities.some(
          entityType => entityType === type
        )

        const getNext = async (
          url,
          currentLanguage,
          filterByLanguages,
          renamedEnabledLanguages
        ) => {
          if (typeof url === `object`) {
            // url は文字列のことも、href フィールドを持つオブジェクトのこともある
            url = url.href

            // gatsby-config.js で設定されたフィルターを適用する。フィルターには、
            // 有効な JSON API のフィルタークエリ文字列であれば何でも指定できる。
            // https://www.drupal.org/docs/8/modules/jsonapi/filtering を参照
            if (typeof filters === `object`) {
              if (filters.hasOwnProperty(type)) {
                url = new URL(url)
                const filterParams = new URLSearchParams(filters[type])
                const filterKeys = Array.from(filterParams.keys())
                filterKeys.forEach(filterKey => {
                  // フィルターパラメーターは、まだ追加されていない場合にだけ
                  // URL に追加する。
                  if (!url.searchParams.has(filterKey)) {
                    url.searchParams.set(filterKey, filterParams.get(filterKey))
                  }
                })
                url = url.toString()
              }
            }
          }

          // proxyUrl が定義されていれば、コンテンツの取得に baseUrl ではなくそちらを使う。
          if (proxyUrl !== baseUrl) {
            url = url.replace(baseUrl, proxyUrl)
          }

          let d
          try {
            d = await requestQueue.push([
              url,
              {
                username: basicAuth.username,
                password: basicAuth.password,
                headers,
                searchParams: params,
                responseType: `json`,
                parentSpan: fullFetchSpan,
                timeout: {
                  // Drupal へのリクエストは、ときどき止まることがある。その場合にリトライできるよう、（デフォルトで）30 秒のタイムアウトを設定する。
                  request: requestTimeoutMS,
                },
              },
            ])
          } catch (error) {
            if (error.response && error.response.statusCode == 405) {
              // このエンドポイントは GET メソッドに対応していないので、スキップする。
              return
            } else {
              console.error(`Failed to fetch ${url}`, error.message)
              console.log(error)
              throw error
            }
          }

          if (d.body.data && currentLanguage && filterByLanguages) {
            const languageCodeForFilter =
              renamedEnabledLanguages &&
              renamedEnabledLanguages.find(
                language => language.as === currentLanguage
              )
                ? renamedEnabledLanguages.find(
                    language => language.as === currentLanguage
                  ).langCode
                : currentLanguage

            d.body.data = d.body.data.filter(
              n => n.attributes.langcode === languageCodeForFilter
            )
          }

          if (d.body.data) {
            // @ts-ignore
            dataArray.push(...(d.body.data || []))
          }

          // includes に対応する。includes を使うと、リレーションシップに基づいて
          // エンティティのデータを展開できる。展開されたデータは、JSON API の
          // レスポンスの `included` として公開される。
          // https://www.drupal.org/docs/8/modules/jsonapi/includes を参照
          if (d.body.included) {
            // @ts-ignore
            dataArray.push(...(d.body.included || []))
          }

          // JSON:API extras がリソース数を追加するように設定されていれば、各リクエストが
          // 次の URL を返すのを待たずに、すべての API リクエストをすぐにキューへ入れられる。
          // これにより、リソースを順番にではなく並列にリクエストでき、
          // はるかに速くなる。
          if (d.body.meta?.count) {
            const typeLangKey = type + currentLanguage
            // まだ URL を追加していない場合
            if (
              d.body.links.next?.href &&
              !typeRequestsQueued.has(typeLangKey)
            ) {
              typeRequestsQueued.add(typeLangKey)

              // API リクエストの数を求める
              // この時点で最初のページは取得済みなので、切り捨てる。
              const pageSize = Number(
                new URL(d.body.links.next.href).searchParams.get(`page[limit]`)
              )
              const requestsCount = Math.floor(d.body.meta.count / pageSize)

              reporter.verbose(
                `queueing ${requestsCount} API requests for type ${type} which has ${d.body.meta.count} entities.`
              )

              const newUrl = new URL(d.body.links.next.href)
              await Promise.all(
                _.range(requestsCount).map((pageOffset: number) => {
                  // 1 つ先から始める。
                  pageOffset += 1
                  // 新しい pageOffset で URL を組み立てる。
                  newUrl.searchParams.set(
                    `page[offset]`,
                    String(pageOffset * pageSize)
                  )
                  return getNext(
                    newUrl.toString(),
                    currentLanguage,
                    filterByLanguages,
                    renamedEnabledLanguages
                  )
                })
              )
            }
          } else if (d.body.links?.next) {
            await getNext(
              d.body.links.next,
              currentLanguage,
              filterByLanguages,
              renamedEnabledLanguages
            )
          }
        }

        if (isTranslatable === false) {
          await getNext(url, ``, false, ``)
        } else {
          for (let i = 0; i < languageConfig.enabledLanguages.length; i++) {
            let currentLanguage = languageConfig.enabledLanguages[i]
            const urlPath = url.href.split(`${apiBase}/`).pop()
            const baseUrlWithoutTrailingSlash = baseUrl.replace(/\/$/, ``)
            // デフォルト言語の JSON API はルートにある。

            if (
              currentLanguage === getOptions().languageConfig.defaultLanguage ||
              baseUrlWithoutTrailingSlash.slice(-currentLanguage.length) ==
                currentLanguage
            ) {
              currentLanguage = ``
            }

            const joinedUrl = urlJoin(
              baseUrlWithoutTrailingSlash,
              currentLanguage,
              apiBase,
              urlPath
            )

            const renamedEnabledLanguages =
              getOptions().languageConfig.renamedEnabledLanguages
            const filterByLanguages =
              getOptions().languageConfig.filterByLanguages
            await getNext(
              joinedUrl,
              currentLanguage,
              filterByLanguages,
              renamedEnabledLanguages
            )
          }
        }

        const result = {
          type,
          data: dataArray,
        }

        // eslint-disable-next-line consistent-return
        return result
      })
    )
  } catch (e) {
    gracefullyRethrow(drupalFetchActivity, e)
    return
  }

  drupalFetchActivity.end()
  fullFetchSpan.finish()

  const createNodesSpan = tracer.startSpan(`sourceNodes.createNodes`, {
    childOf: parentSpan,
  })
  createNodesSpan.setTag(`plugin`, `gatsby-source-drupal`)
  createNodesSpan.setTag(`sourceNodes.fetch.type`, `full`)

  const nodes = new Map()
  const fileNodesExtendedData = getExtendedFileNodeData(allData)

  // 1 回目のパス: 基本的なノードを作成する
  for (const contentType of allData) {
    if (!contentType) {
      continue
    }

    await asyncPool(concurrentFileRequests, contentType.data, async datum => {
      if (!datum) {
        return
      }

      const node = await nodeFromData(
        datum,
        createNodeId,
        entityReferenceRevisions,
        pluginOptions,
        fileNodesExtendedData,
        reporter
      )

      drupalCreateNodeManifest({
        attributes: datum?.attributes,
        gatsbyNode: node,
        unstable_createNodeManifest,
      })

      nodes.set(node.id, node)
    })
  }

  if (
    skipFileDownloads &&
    !imageCDNState.foundPlaceholderStyle &&
    !imageCDNState.hasLoggedNoPlaceholderStyle
  ) {
    imageCDNState.hasLoggedNoPlaceholderStyle = true
    reporter.warn(
      `[gatsby-source-drupal]\nNo Gatsby Image CDN placeholder style found. Please ensure that you have a placeholder style in your Drupal site for the fastest builds. See the docs for more info on gatsby-source-drupal Image CDN support:\n${imageCdnDocs}\n`
    )
  }

  createNodesSpan.setTag(`sourceNodes.createNodes.count`, nodes.size)

  // 2 回目のパス: リレーションシップとバックリファレンスを処理する
  for (const node of Array.from(nodes.values())) {
    await handleReferences(node, {
      getNode: nodes.get.bind(nodes),
      mutateNode: true,
      createNodeId,
      cache,
      entityReferenceRevisions,
      pluginOptions,
    })
  }

  if (skipFileDownloads) {
    reporter.info(`Skipping remote file download from Drupal`)
  } else {
    reporter.info(`Downloading remote files from Drupal`)

    // すべてのファイルをダウンロードする（同時実行の問題を避けるため、各プールの完了を await する）
    const fileNodes = [...nodes.values()].filter(node =>
      isFileNode(node, pluginOptions.typePrefix)
    )

    if (fileNodes.length) {
      const downloadingFilesActivity = reporter.activityTimer(
        `Remote file download`,
        { parentSpan }
      )
      downloadingFilesActivity.start()
      try {
        await asyncPool(concurrentFileRequests, fileNodes, async node => {
          await downloadFile(
            {
              node,
              cache,
              createNode,
              createNodeId,
              getCache,
            },
            pluginOptions
          )
        })
      } catch (e) {
        gracefullyRethrow(downloadingFilesActivity, e)
        return
      }
      downloadingFilesActivity.end()
    }
  }

  // 各ノードを作成する
  for (const node of nodes.values()) {
    node.internal.contentDigest = createContentDigest(node)
    createNode(node)
  }

  // これで、最初のソーシングは完了である。
  initialSourcing = false

  createNodesSpan.finish()
  return
}

// これは過去の経緯のために残しているもので、いずれ削除される。
exports.onCreateDevServer = (
  {
    app,
    createNodeId,
    getNode,
    actions,
    cache,
    createContentDigest,
    getCache,
    reporter,
  },
  pluginOptions
) => {
  app.use(
    `/___updatePreview/`,
    bodyParser.text({
      type: `application/json`,
    }),
    async (req, res) => {
      console.warn(
        `The ___updatePreview callback is now deprecated and will be removed in the future. Please use the __refresh callback instead.`
      )
      if (!_.isEmpty(req.body)) {
        const requestBody = JSON.parse(JSON.parse(req.body))
        const { secret, action, id } = requestBody
        if (pluginOptions.secret && pluginOptions.secret !== secret) {
          return reporter.warn(
            `The secret in this request did not match your plugin options secret.`
          )
        }
        if (action === `delete`) {
          actions.deleteNode(getNode(createNodeId(id)))
          return reporter.log(`Deleted node: ${id}`)
        }
        const nodeToUpdate = JSON.parse(JSON.parse(req.body)).data
        return await handleWebhookUpdate(
          {
            nodeToUpdate,
            actions,
            cache,
            createNodeId,
            createContentDigest,
            getCache,
            getNode,
            reporter,
          },
          pluginOptions
        )
      } else {
        res.status(400).send(`Received body was empty!`)
        return reporter.log(`Received body was empty!`)
      }
    }
  )
}

exports.pluginOptionsSchema = ({ Joi }) =>
  Joi.object({
    baseUrl: Joi.string()
      .required()
      .description(`The URL to root of your Drupal instance`),
    proxyUrl: Joi.string().description(
      `The CDN URL equivalent to your baseUrl`
    ),
    apiBase: Joi.string().description(
      `The path to the root of the JSONAPI — defaults to "jsonapi"`
    ),
    basicAuth: Joi.object({
      username: Joi.string().required(),
      password: Joi.string().required(),
    }).description(`Enables basicAuth`),
    filters: Joi.object().description(
      `Pass filters to the JSON API for specific collections`
    ),
    headers: Joi.object().description(
      `Set request headers for requests to the JSON API`
    ),
    params: Joi.object().description(`Append optional GET params to requests`),
    concurrentFileRequests: Joi.number().integer().default(20).min(1),
    concurrentAPIRequests: Joi.number().integer().default(20).min(1),
    requestTimeoutMS: Joi.number().integer().default(30000).min(1),
    disallowedLinkTypes: Joi.array().items(Joi.string()),
    skipFileDownloads: Joi.boolean(),
    imageCDN: Joi.boolean().default(true),
    typePrefix: Joi.string()
      .description(`Prefix for Drupal node types`)
      .default(``),
    fastBuilds: Joi.boolean(),
    entityReferenceRevisions: Joi.array().items(Joi.string()),
    secret: Joi.string().description(
      `an optional secret token for added security shared between your Drupal instance and Gatsby preview`
    ),
    languageConfig: Joi.object({
      defaultLanguage: Joi.string().required(),
      enabledLanguages: Joi.array()
        .items(
          Joi.string(),
          Joi.object({
            langCode: Joi.string().required(),
            as: Joi.string().required(),
          })
        )
        .required(),
      filterByLanguages: Joi.boolean().default(false),
      translatableEntities: Joi.array().items(Joi.string()).required(),
      nonTranslatableEntities: Joi.array().items(Joi.string()).required(),
    }),
    placeholderStyleName: Joi.string().description(
      `The machine name of the Gatsby Image CDN placeholder style in Drupal. The default is "placeholder".`
    ),
  })

exports.onCreateDevServer = async ({ app, store }) => {
  // これにより、gatsby develop の image CDN エミュレーターが、以前のバージョンの Gatsby でも動くようになる。
  polyfillImageServiceDevRoutes(app, store)
}

exports.createSchemaCustomization = (
  { actions, schema, store, reporter },
  pluginOptions
) => {
  if (pluginOptions.skipFileDownloads && pluginOptions.imageCDN) {
    actions.createTypes([
      // 古いバージョンの Gatsby でも image CDN が動くようにするためのポリフィル
      // この型は、推論された file__file 型と files 型にマージされ、GraphQL の gatsbyImage フィールドを通じて Image CDN への対応を追加する。gatsbyImage フィールドを追加するのは、`RemoteFile` インターフェースと上のポリフィルである。
      addRemoteFilePolyfillInterface(
        schema.buildObjectType({
          name: generateTypeName(`file--file`, pluginOptions.typePrefix),
          fields: {},
          interfaces: [`Node`, `RemoteFile`],
        }),
        {
          schema,
          actions,
          store,
        }
      ),
      addRemoteFilePolyfillInterface(
        schema.buildObjectType({
          name: generateTypeName(`files`, pluginOptions.typePrefix),
          fields: {},
          interfaces: [`Node`, `RemoteFile`],
        }),
        {
          schema,
          actions,
          store,
        }
      ),
    ])
  } else {
    reporter.info(
      `[gatsby-source-drupal] Enable the skipFileDownloads option to use Gatsby's Image CDN. See the docs for more info:\n${imageCdnDocs}\n`
    )
  }
}
