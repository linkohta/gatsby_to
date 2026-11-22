const moment = require(`moment`)
const chokidar = require(`chokidar`)
const systemPath = require(`path`)
const _ = require(`lodash`)

const { emitter, store } = require(`../../redux`)
const { actions } = require(`../../redux/actions`)
const { getNode } = require(`../../datastore`)
const {
  findCompiledLocalPluginModule,
} = require(`../../utils/parcel/compile-gatsby-files`)

function transformPackageJson(json) {
  const transformDeps = deps =>
    _.entries(deps).map(([name, version]) => {
      return {
        name,
        version,
      }
    })

  json = _.pick(json, [
    `name`,
    `description`,
    `version`,
    `main`,
    `keywords`,
    `author`,
    `license`,
    `dependencies`,
    `devDependencies`,
    `peerDependencies`,
    `optionalDependecies`,
    `bundledDependecies`,
  ])
  json.dependencies = transformDeps(json.dependencies)
  json.devDependencies = transformDeps(json.devDependencies)
  json.peerDependencies = transformDeps(json.peerDependencies)
  json.optionalDependecies = transformDeps(json.optionalDependecies)
  json.bundledDependecies = transformDeps(json.bundledDependecies)

  return json
}

const createPageId = path => `SitePage ${path}`

exports.sourceNodes = ({
  createContentDigest,
  getNodesByType,
  actions,
  store,
}) => {
  const { createNode, deleteNode } = actions
  const { program, flattenedPlugins, config } = store.getState()

  flattenedPlugins.forEach(plugin => {
    plugin.pluginFilepath = plugin.resolve

    createNode({
      ...plugin,
      packageJson: transformPackageJson(
        require(`${plugin.resolve}/package.json`)
      ),
      parent: null,
      children: [],
      internal: {
        contentDigest: createContentDigest(plugin),
        type: `SitePlugin`,
      },
    })
  })

  // site ノードを追加する。

  const createGatsbyConfigNode = (config = {}) => {
    // プラグインは上で追加しているので、config から plugins を削除する。
    const configCopy = { ...config }
    delete configCopy.plugins
    const node = {
      siteMetadata: {
        ...configCopy.siteMetadata,
      },
      port: program.port,
      host: program.host,
      ...configCopy,
    }
    createNode({
      ...node,
      id: `Site`,
      parent: null,
      children: [],
      internal: {
        contentDigest: createContentDigest(node),
        type: `Site`,
      },
    })
  }

  createGatsbyConfigNode(config)

  const buildTime = moment()
    .subtract(process.uptime(), `seconds`)
    .startOf(`second`)
    .toJSON()

  const metadataNode = { buildTime }

  createNode({
    ...metadataNode,
    id: `SiteBuildMetadata`,
    parent: null,
    children: [],
    internal: {
      contentDigest: createContentDigest(metadataNode),
      type: `SiteBuildMetadata`,
    },
  })

  const pathToGatsbyConfig =
    findCompiledLocalPluginModule(
      program.directory,
      `default-site-plugin`,
      `gatsby-config`
    ) ?? systemPath.join(program.directory, `gatsby-config.js`)
  watchConfig(pathToGatsbyConfig, createGatsbyConfigNode)

  // 関数のノードを作成する
  const { functions } = store.getState()
  const createFunctionNode = config => {
    createNode({
      id: `gatsby-function-${config.absoluteCompiledFilePath}`,
      ...config,
      parent: null,
      children: [],
      internal: {
        contentDigest: createContentDigest(config),
        type: `SiteFunction`,
      },
    })
  }
  functions.forEach(config => {
    createFunctionNode(config)
  })

  // 関数の更新を監視して、ノードを更新する。
  emitter.on(`SET_SITE_FUNCTIONS`, action => {
    // 削除された関数を特定して、そのノードを削除する。
    const existingNodes = getNodesByType(`SiteFunction`)
    const newFunctionsSet = new Set()
    action.payload.forEach(config =>
      newFunctionsSet.add(`gatsby-function-${config.absoluteCompiledFilePath}`)
    )
    const toBeDeleted = existingNodes.filter(
      node => !newFunctionsSet.has(node.id)
    )
    toBeDeleted.forEach(node => deleteNode(node))

    action.payload.forEach(config => {
      createFunctionNode(config)
    })
  })
}

function watchConfig(pathToGatsbyConfig, createGatsbyConfigNode) {
  chokidar.watch(pathToGatsbyConfig).on(`change`, () => {
    const oldCache = require.cache[require.resolve(pathToGatsbyConfig)]
    try {
      // モジュールを再読み込みできるように、require キャッシュを削除する。
      delete require.cache[require.resolve(pathToGatsbyConfig)]
      const config = require(pathToGatsbyConfig)
      createGatsbyConfigNode(config)
    } catch (e) {
      // 新しい gatsby-config.js の require に失敗したので、古いキャッシュを復元する。
      if (oldCache !== undefined) {
        require.cache[require.resolve(pathToGatsbyConfig)] = oldCache
      }
    }
  })
}

exports.createResolvers = ({ createResolvers }) => {
  const resolvers = {
    Site: {
      buildTime: {
        type: `Date`,
        resolve(source, args, context, info) {
          const { buildTime } = context.nodeModel.getNodeById({
            id: `SiteBuildMetadata`,
            type: `SiteBuildMetadata`,
          })
          return info.originalResolver(
            {
              ...source,
              buildTime,
            },
            args,
            context,
            info
          )
        },
      },
    },
  }

  createResolvers(resolvers)
}

// DELETE_PAGE を監視して、ページのノードを削除する。
emitter.on(`DELETE_PAGE`, action => {
  const nodeId = createPageId(action.payload.path)
  const node = getNode(nodeId)
  store.dispatch(actions.deleteNode(node))
})
