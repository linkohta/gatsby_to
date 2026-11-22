const chokidar = require(`chokidar`)
const fs = require(`fs`)
const path = require(`path`)
const { createMachine, interpret, assign } = require(`xstate`)

const { createFileNode } = require(`./create-file-node`)
const { ERROR_MAP } = require(`./error-utils`)

exports.onPreInit = ({ reporter }) => {
  if (reporter.setErrorMap) {
    reporter.setErrorMap(ERROR_MAP)
  }
}

/**
 * Chokidar の not-ready/ready の状態を管理するステートマシンを作成する。
 */
const createFSMachine = (
  {
    actions: { createNode, deleteNode },
    getNode,
    createNodeId,
    reporter,
    cache,
  },
  pluginOptions
) => {
  const createAndProcessNode = path => {
    const fileNodePromise = createFileNode(
      path,
      createNodeId,
      pluginOptions,
      cache
    ).then(fileNode => {
      createNode(fileNode)
      return null
    })
    return fileNodePromise
  }

  const deletePathNode = path => {
    const node = getNode(createNodeId(path))
    // ツールによっては、一時ファイルをファイルシステムに書き込んですぐに削除することがあるので、
    // ノードが一度も作成されていない可能性がある。
    if (node) {
      deleteNode(node)
    }
  }

  // 'ready' イベントの前に報告されたパスはすべてキューに入れておき、
  // 'ready' イベントが届いたときにキューを処理する。
  // 'ready' の後は、'add' イベントをキューに入れずに処理する。
  let pathQueue = []
  const flushPathQueue = () => {
    const queue = pathQueue.slice()
    pathQueue = null
    return Promise.all(
      // eslint-disable-next-line consistent-return
      queue.map(({ op, path }) => {
        switch (op) {
          case `delete`:
            return deletePathNode(path)
          case `upsert`:
            return createAndProcessNode(path)
        }
      })
    )
  }

  const log = expr => (ctx, action, meta) => {
    if (ctx.bootstrapped) {
      reporter.info(expr(ctx, action, meta))
    }
  }

  const fsMachine = createMachine(
    {
      predictableActionArguments: true,
      context: {
        bootstrapped: false,
      },
      id: `fs`,
      type: `parallel`,
      states: {
        BOOTSTRAP: {
          initial: `BOOTSTRAPPING`,
          states: {
            BOOTSTRAPPING: {
              on: {
                BOOTSTRAP_FINISHED: `BOOTSTRAPPED`,
              },
            },
            BOOTSTRAPPED: {
              type: `final`,
              entry: assign({ bootstrapped: true }),
            },
          },
        },
        CHOKIDAR: {
          initial: `NOT_READY`,
          states: {
            NOT_READY: {
              on: {
                CHOKIDAR_READY: `READY`,
                CHOKIDAR_ADD: { actions: `queueNodeProcessing` },
                CHOKIDAR_CHANGE: { actions: `queueNodeProcessing` },
                CHOKIDAR_UNLINK: { actions: `queueNodeDeleting` },
              },
              exit: `flushPathQueue`,
            },
            READY: {
              on: {
                CHOKIDAR_ADD: {
                  actions: [
                    `createAndProcessNode`,
                    log(
                      (_, { pathType, path }) => `added ${pathType} at ${path}`
                    ),
                  ],
                },
                CHOKIDAR_CHANGE: {
                  actions: [
                    `createAndProcessNode`,
                    log(
                      (_, { pathType, path }) =>
                        `changed ${pathType} at ${path}`
                    ),
                  ],
                },
                CHOKIDAR_UNLINK: {
                  actions: [
                    `deletePathNode`,
                    log(
                      (_, { pathType, path }) =>
                        `deleted ${pathType} at ${path}`
                    ),
                  ],
                },
              },
            },
          },
        },
      },
    },
    {
      actions: {
        createAndProcessNode(_, { pathType, path }) {
          createAndProcessNode(path).catch(err => reporter.error(err))
        },
        deletePathNode(_, { pathType, path }, { state }) {
          deletePathNode(path)
        },
        flushPathQueue(_, { resolve, reject }) {
          flushPathQueue().then(resolve, reject)
        },
        queueNodeDeleting(_, { path }) {
          pathQueue.push({ op: `delete`, path })
        },
        queueNodeProcessing(_, { path }) {
          pathQueue.push({ op: `upsert`, path })
        },
      },
    }
  )
  return interpret(fsMachine).start()
}

exports.pluginOptionsSchema = ({ Joi }) =>
  Joi.object({
    name: Joi.string(),
    path: Joi.string(),
    fastHash: Joi.boolean().default(false),
    ignore: Joi.array().items(
      Joi.string(),
      Joi.object().regex(),
      Joi.function()
    ),
  })

exports.sourceNodes = (api, pluginOptions) => {
  // パスが存在することを検証する。
  if (!fs.existsSync(pluginOptions.path)) {
    api.reporter.panic(`
The path passed to gatsby-source-filesystem does not exist on your file system:
${pluginOptions.path}
Please pick a path to an existing directory.
See docs here - https://www.gatsbyjs.com/plugins/gatsby-source-filesystem/
      `)
  }

  // パスが絶対パスであることを検証する。
  // 画像を正しく解決するには絶対パスが必要である。
  if (!path.isAbsolute(pluginOptions.path)) {
    pluginOptions.path = path.resolve(process.cwd(), pluginOptions.path)
  }

  const fsMachine = createFSMachine(api, pluginOptions)

  // ブートストラップが終わった後は、File ノードの更新を一度に 1 つずつしか
  // システムに通さない。
  api.emitter.on(`BOOTSTRAP_FINISHED`, () => {
    fsMachine.send(`BOOTSTRAP_FINISHED`)
  })

  const watcher = chokidar.watch(pluginOptions.path, {
    ignored: [
      `**/*.un~`,
      `**/.DS_Store`,
      `**/.gitignore`,
      `**/.npmignore`,
      `**/.babelrc`,
      `**/yarn.lock`,
      `**/bower_components`,
      `**/node_modules`,
      `../**/dist/**`,
      ...(pluginOptions.ignore || []),
    ],
  })

  watcher.on(`add`, path => {
    fsMachine.send({ type: `CHOKIDAR_ADD`, pathType: `file`, path })
  })

  watcher.on(`change`, path => {
    fsMachine.send({ type: `CHOKIDAR_CHANGE`, pathType: `file`, path })
  })

  watcher.on(`unlink`, path => {
    fsMachine.send({ type: `CHOKIDAR_UNLINK`, pathType: `file`, path })
  })

  watcher.on(`addDir`, path => {
    fsMachine.send({ type: `CHOKIDAR_ADD`, pathType: `directory`, path })
  })

  watcher.on(`unlinkDir`, path => {
    fsMachine.send({ type: `CHOKIDAR_UNLINK`, pathType: `directory`, path })
  })

  return new Promise((resolve, reject) => {
    watcher.on(`ready`, () => {
      fsMachine.send({ type: `CHOKIDAR_READY`, resolve, reject })
    })
  })
}

exports.setFieldsOnGraphQLNodeType = require(`./extend-file-node`)
