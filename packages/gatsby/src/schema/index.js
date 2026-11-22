/* @flow */

const tracer = require(`opentracing`).globalTracer()
const { store } = require(`../redux`)
const { getDataStore, getTypes } = require(`../datastore`)
const { createSchemaComposer } = require(`./schema-composer`)
const { buildSchema } = require(`./schema`)
const { builtInFieldExtensions } = require(`./extensions`)
const { builtInTypeDefinitions } = require(`./types/built-in-types`)
const { TypeConflictReporter } = require(`./infer/type-conflict-reporter`)
const { shouldPrintEngineSnapshot } = require(`../utils/engines-helpers`)

const getAllTypeDefinitions = () => {
  const {
    schemaCustomization: { types },
  } = store.getState()

  const builtInTypes = builtInTypeDefinitions().map(typeDef => {
    return {
      typeOrTypeDef: typeDef,
      plugin: undefined,
    }
  })

  // ユーザー定義の型が最後に処理されるようにする
  return [
    ...builtInTypes,
    ...types.filter(
      type => type.plugin && type.plugin.name !== `default-site-plugin`
    ),
    ...types.filter(
      type => !type.plugin || type.plugin.name === `default-site-plugin`
    ),
  ]
}

const getAllFieldExtensions = () => {
  const {
    schemaCustomization: { fieldExtensions: customFieldExtensions },
  } = store.getState()

  return {
    ...customFieldExtensions,
    ...builtInFieldExtensions,
  }
}

// スキーマのビルドには、型推論のためのメタデータが必要である。
// 具体的には、型のすべてのノードをループしてノードの構造を解析し、
// 集約したノードの構造を、対応する GraphQL の型で使うことを意味する。
// 推論の実際のロジックは、inferenceMetadata レデューサーと ./infer にある
// ここでは、redux のアクションを通じて処理の流れを調整するだけである
const buildInferenceMetadata = ({ types }) =>
  new Promise(resolve => {
    if (!types || !types.length) {
      resolve()
      return
    }
    const typeNames = [...types]
    // TODO: node>=10 に切り替えたら async イテレーターを使う
    //  あるいは、メタデータの構築をワーカーや Jobs API に任せて、
    //  その結果を redux に渡せないかを調べるほうがよいか？
    const processNextType = async () => {
      const typeName = typeNames.pop()

      let processingNodes = []
      let dispatchCount = 0
      function dispatchNodes() {
        return new Promise(res => {
          store.dispatch({
            type: `BUILD_TYPE_METADATA`,
            payload: {
              typeName,
              // この型の最初のチャンクでだけメタデータを消去する
              clearExistingMetadata: dispatchCount++ === 0,
              nodes: processingNodes,
            },
          })
          setImmediate(() => {
            // BUILD_TYPE_METADATA レデューサーが同期的に実行された後に、この配列を消去する
            processingNodes = []
            // イベントループをブロックしない。node は必要に応じて、前の processingNodes 配列をメモリーから解放するかもしれない。
            setImmediate(() => {
              res(null)
            })
          })
        })
      }

      for (const node of getDataStore().iterateNodesByType(typeName)) {
        processingNodes.push(node)

        if (processingNodes.length > 1000) {
          await dispatchNodes()
        }
      }

      if (processingNodes.length > 0) {
        await dispatchNodes()
      }

      if (typeNames.length > 0) {
        // イベントループをブロックしない
        setImmediate(() => processNextType())
      } else {
        resolve()
      }
    }
    processNextType()
  })

const build = async ({ parentSpan, fullMetadataBuild = true }) => {
  const spanArgs = parentSpan ? { childOf: parentSpan } : {}
  const span = tracer.startSpan(`build schema`, spanArgs)
  await getDataStore().ready()

  if (fullMetadataBuild) {
    // 型推論のためのメタデータを構築し、インクリメンタルな更新を始める
    await buildInferenceMetadata({ types: getTypes() })
    store.dispatch({ type: `START_INCREMENTAL_INFERENCE` })
  }

  const {
    schemaCustomization: { thirdPartySchemas, printConfig },
    inferenceMetadata,
    config: { mapping: typeMapping },
    program: { directory },
  } = store.getState()

  const typeConflictReporter = new TypeConflictReporter()

  const enginePrintConfig = shouldPrintEngineSnapshot()
    ? {
        path: `${directory}/.cache/schema.gql`,
        rewrite: true,
      }
    : undefined

  const fieldExtensions = getAllFieldExtensions()
  const schemaComposer = createSchemaComposer({ fieldExtensions })
  const schema = await buildSchema({
    schemaComposer,
    types: getAllTypeDefinitions(),
    fieldExtensions,
    thirdPartySchemas,
    typeMapping,
    printConfig,
    enginePrintConfig,
    typeConflictReporter,
    inferenceMetadata,
    parentSpan,
  })

  typeConflictReporter.printConflicts()

  store.dispatch({
    type: `SET_SCHEMA_COMPOSER`,
    payload: schemaComposer,
  })
  store.dispatch({
    type: `SET_SCHEMA`,
    payload: schema,
  })

  span.finish()
}

const rebuild = async ({ parentSpan }) =>
  await build({ parentSpan, fullMetadataBuild: false })

module.exports = {
  build,
  rebuild,
}
