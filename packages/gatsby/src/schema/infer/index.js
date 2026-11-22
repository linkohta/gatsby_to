const report = require(`gatsby-cli/lib/reporter`)
const { ObjectTypeComposer } = require(`graphql-compose`)
const { hasNodes } = require(`./inference-metadata`)
const { getExampleObject } = require(`./build-example-data`)
const { addNodeInterface } = require(`../types/node-interface`)
const { addInferredFields } = require(`./add-inferred-fields`)
const { getDataStore } = require(`../../datastore`)

const addInferredTypes = ({
  schemaComposer,
  typeConflictReporter,
  typeMapping,
  inferenceMetadata,
  parentSpan,
}) => {
  // XXX(freiksenet): プラグインが typedefs を設定するようになれば不要になる
  // File へのすべてのリンクが動くように、File を最初に推論する
  const { typeMap } = inferenceMetadata
  const typesWithNodes = Object.keys(typeMap).filter(typeName =>
    hasNodes(typeMap[typeName])
  )
  const typeNames = putFileFirst(typesWithNodes)
  const noNodeInterfaceTypes = []

  const typesToInfer = []

  typeNames.forEach(typeName => {
    let typeComposer
    if (schemaComposer.has(typeName)) {
      typeComposer = schemaComposer.getOTC(typeName)
      const runInfer = typeComposer.hasExtension(`infer`)
        ? typeComposer.getExtension(`infer`)
        : true
      if (runInfer) {
        if (!typeComposer.hasInterface(`Node`)) {
          noNodeInterfaceTypes.push(typeName)
        }
        typesToInfer.push(typeComposer)
      }
    } else {
      typeComposer = ObjectTypeComposer.create(typeName, schemaComposer)
      addNodeInterface({ schemaComposer, typeComposer })
      typeComposer.setExtension(`createdFrom`, `inference`)
      typesToInfer.push(typeComposer)
    }
  })

  if (noNodeInterfaceTypes.length > 0) {
    noNodeInterfaceTypes.forEach(typeName => {
      report.warn(
        `Type \`${typeName}\` declared in \`createTypes\` looks like a node, ` +
          `but doesn't implement a \`Node\` interface. It's likely that you should ` +
          `add the \`Node\` interface to your type def:\n\n` +
          `\`type ${typeName} implements Node { ... }\`\n\n` +
          `If you know that you don't want it to be a node (which would mean no ` +
          `root queries to retrieve it), you can explicitly disable inference ` +
          `for it:\n\n` +
          `\`type ${typeName} @dontInfer { ... }\``
      )
    })
    report.panic(`Building schema failed`)
  }

  return typesToInfer.map(typeComposer =>
    addInferredType({
      schemaComposer,
      typeComposer,
      typeConflictReporter,
      typeMapping,
      parentSpan,
      inferenceMetadata,
    })
  )
}

const addInferredType = ({
  schemaComposer,
  typeComposer,
  typeConflictReporter,
  typeMapping,
  inferenceMetadata = {},
  parentSpan,
}) => {
  const typeName = typeComposer.getTypeName()
  // TODO: ノードの型の所有者の情報をストアから直接取得できるように
  // なったら、これを型を作成する場所へ移す
  if (
    typeComposer.getExtension(`createdFrom`) === `inference` &&
    hasNodes(inferenceMetadata.typeMap[typeName])
  ) {
    let firstNode
    for (const node of getDataStore().iterateNodesByType(typeName)) {
      firstNode = node
      break
    }
    if (firstNode) {
      typeComposer.setExtension(`plugin`, firstNode.internal.owner)
    }
  }

  const exampleValue = getExampleObject({
    ...inferenceMetadata.typeMap[typeName],
    typeName,
    typeConflictReporter,
  })

  addInferredFields({
    schemaComposer,
    typeComposer,
    exampleValue,
    typeMapping,
    parentSpan,
  })
  return typeComposer
}

const putFileFirst = typeNames => {
  const index = typeNames.indexOf(`File`)
  if (index !== -1) {
    return [`File`, ...typeNames.slice(0, index), ...typeNames.slice(index + 1)]
  } else {
    return typeNames
  }
}

module.exports = {
  addInferredType,
  addInferredTypes,
}
