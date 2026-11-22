const axios = require(`axios`)
const Queue = require(`fastq`)
const { createRemoteFileNode } = require(`gatsby-source-filesystem`)

const LAMBDA_CONCURRENCY_LIMIT = 50
const USE_PLACEHOLDER_IMAGE = process.env.GATSBY_SCREENSHOT_PLACEHOLDER

const screenshotQueue = Queue.promise(worker, LAMBDA_CONCURRENCY_LIMIT)

async function worker(input) {
  // maxRetries: 3, retryDelay: 1000
  for (let i = 0; i < 2; i++) {
    try {
      return await createScreenshotNode(input)
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  return await createScreenshotNode(input)
}

exports.onPreBootstrap = (
  {
    cache,
    actions,
    createNodeId,
    getCache,
    getNode,
    getNodesByType,
    createContentDigest,
  },
  pluginOptions
) => {
  const { createNode, touchNode } = actions
  const screenshotNodes = getNodesByType(`Screenshot`)

  if (screenshotNodes.length === 0) {
    return null
  }

  let anyQueued = false

  // 更新されたスクリーンショットとプレースホルダーのフラグを確認し、
  // Gatsby がリモートファイルのノードをガベージコレクションしないようにする
  screenshotNodes.forEach(n => {
    if (
      (n.expires && new Date() >= new Date(n.expires)) ||
      USE_PLACEHOLDER_IMAGE !== n.usingPlaceholder
    ) {
      anyQueued = true
      // スクリーンショットの期限が切れているので、Lambda を再実行する
      screenshotQueue.push({
        url: n.url,
        parent: n.parent,
        cache,
        createNode,
        createNodeId,
        getCache,
        parentNodeId: n.id,
        createContentDigest,
        pluginOptions,
      })
    } else {
      // スクリーンショットの期限がまだ切れていないので、ガベージコレクションを
      // 防ぐために画像ノードを touch する
      touchNode(getNode(n.screenshotFile___NODE))
    }
  })

  if (!anyQueued) {
    return null
  }

  return new Promise(resolve => {
    screenshotQueue.drain = () => {
      resolve()
    }
  })
}

function shouldOnCreateNode({ node }, pluginOptions) {
  /*
   * ノードが対象の型であり、url フィールドを持っているかを確認する
   * （もともとは sites.yml だけを確認していたので、デフォルトで含めている）
   */
  const validNodeTypes = [`SitesYaml`].concat(pluginOptions.nodeTypes || [])
  return validNodeTypes.includes(node.internal.type) && node.url
}

exports.shouldOnCreateNode = shouldOnCreateNode

exports.onCreateNode = async (
  { node, actions, store, cache, createNodeId, createContentDigest, getCache },
  pluginOptions
) => {
  const { createNode, createParentChildLink } = actions

  try {
    const screenshotNode = await screenshotQueue.push({
      url: node.url,
      parent: node.id,
      store,
      cache,
      createNode,
      createNodeId,
      getCache,
      createContentDigest,
      parentNodeId: node.id,
      pluginOptions,
    })

    createParentChildLink({
      parent: node,
      child: screenshotNode,
    })
  } catch (e) {
    return
  }
}

const createScreenshotNode = async ({
  url,
  parent,
  cache,
  createNode,
  createNodeId,
  getCache,
  parentNodeId,
  createContentDigest,
  pluginOptions,
}) => {
  try {
    let fileNode
    let expires
    if (USE_PLACEHOLDER_IMAGE) {
      const getPlaceholderFileNode = require(`./placeholder-file-node`)
      fileNode = await getPlaceholderFileNode({
        createNode,
        createNodeId,
      })
      expires = new Date(2999, 1, 1).getTime()
    } else {
      const screenshotResponse = await axios.post(
        pluginOptions.screenshotEndpoint,
        { url }
      )

      fileNode = await createRemoteFileNode({
        url: screenshotResponse.data.url,
        cache,
        createNode,
        createNodeId,
        getCache,
        parentNodeId,
      })
      expires = screenshotResponse.data.expires

      if (!fileNode) {
        throw new Error(`Remote file node is null`, screenshotResponse.data.url)
      }
    }

    const screenshotNode = {
      id: createNodeId(`${parent} >>> Screenshot`),
      url,
      expires,
      parent,
      children: [],
      internal: {
        type: `Screenshot`,
      },
      screenshotFile___NODE: fileNode.id,
      usingPlaceholder: USE_PLACEHOLDER_IMAGE,
    }

    screenshotNode.internal.contentDigest = createContentDigest(screenshotNode)

    createNode(screenshotNode)

    return screenshotNode
  } catch (e) {
    console.log(`Failed to screenshot ${url}. Retrying...`)

    throw e
  }
}
