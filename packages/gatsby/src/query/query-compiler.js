// @flow

/** クエリコンパイラーは、すべてのファイルからクエリとフラグメントを抽出して検証し、
 * それぞれが必要とするフラグメントと一緒にまとめる。これにより、フラグメントは
 * グローバルスコープを持ち、他のどのクエリやフラグメントからでも使える。
 */

const _ = require(`lodash`)

const path = require(`path`)
const normalize = require(`normalize-path`)
const { globSync } = require(`../utils/glob`)

const {
  validate,
  print,
  visit,
  visitWithTypeInfo,
  TypeInfo,
  isAbstractType,
  Kind,
  FragmentsOnCompositeTypesRule,
  LoneAnonymousOperationRule,
  PossibleFragmentSpreadsRule,
  ScalarLeafsRule,
  ValuesOfCorrectTypeRule,
  VariablesAreInputTypesRule,
  VariablesInAllowedPositionRule,
} = require(`graphql`)

import { getGatsbyDependents } from "../utils/gatsby-dependents"
const { store } = require(`../redux`)
import { actions } from "../redux/actions"

import { websocketManager } from "../utils/websocket-manager"
import { getPathToLayoutComponent } from "gatsby-core-utils"
import { tranformDocument } from "./transform-document"
const { default: FileParser } = require(`./file-parser`)
const {
  graphqlError,
  multipleRootQueriesError,
  duplicateFragmentError,
  unknownFragmentError,
} = require(`./graphql-errors`)
const report = require(`gatsby-cli/lib/reporter`)
const { default: errorParser, locInGraphQlToLocInFile } = require(
  `./error-parser`
)

const overlayErrorID = `graphql-compiler`

export default async function compile({ parentSpan } = {}): Promise<
  Map<string, RootQuery>,
> {
  const { program, schema, flattenedPlugins } = store.getState()

  const activity = report.activityTimer(`extract queries from components`, {
    parentSpan,
    id: `query-extraction`,
  })
  activity.start()

  const errors = []
  const addError = errors.push.bind(errors)

  const parsedQueries = await parseQueries({
    base: program.directory,
    additional: resolveThemes(
      flattenedPlugins.map(plugin => {
        return {
          themeDir: plugin.pluginFilepath,
        }
      })
    ),
    addError,
    parentSpan: activity.span,
  })

  const queries = processQueries({
    schema,
    parsedQueries,
    addError,
    parentSpan: activity.span,
  })

  if (errors.length !== 0) {
    const structuredErrors = activity.panicOnBuild(errors)
    if (process.env.gatsby_executing_command === `develop`) {
      websocketManager.emitError(overlayErrorID, structuredErrors)
    }
  } else {
    if (process.env.gatsby_executing_command === `develop`) {
      // ブラウザーのエラーオーバーレイを消すために、第 2 引数を `null` にして emitError を呼ぶ
      websocketManager.emitError(overlayErrorID, null)
    }
  }
  activity.end()

  return queries
}

export const resolveThemes = (themes = []) =>
  themes.reduce((merged, theme) => {
    merged.push(theme.themeDir)
    return merged
  }, [])

export const parseQueries = async ({
  base,
  additional,
  addError,
  parentSpan,
}) => {
  const filesRegex = `*.?(m|c)+(t|j)s?(x)`
  // 検索対象のディレクトリに付け加えるパターン。
  // <searched_directory>/node_modules の中にない、
  // .js、.jsx、.ts、.tsx、.cjs、.cjsx、.cts、.ctsx、.mjs、.mjsx、.mts、.mtsx の
  // すべてのファイルに一致する。
  const pathRegex = `/{${filesRegex},!(node_modules)/**/${filesRegex}}`

  const modulesThatUseGatsby = await getGatsbyDependents()

  let files = [
    path.join(base, `src`),
    path.join(base, `.cache`, `fragments`),
    ...additional.map(additional => path.join(additional, `src`)),
    ...modulesThatUseGatsby.map(module => module.path),
  ].reduce((merged, folderPath) => {
    merged.push(
      ...globSync(path.join(folderPath, pathRegex), {
        nodir: true,
      })
    )
    return merged
  }, [])

  files = files.filter(d => !d.match(/\.d\.ts$/))

  files = files.map(normalize)

  // 以下は削除できるはずであり、今は node_modules をトランスパイルしているので
  // もう不要であることを予備的なテストも示している
  // ただし、これを残しておき、もっと確信（とテスト）が得られてから削除するのが妥当な
  // ケース（たとえばページが src の外にある場合）があるかもしれない

  // すべてのページコンポーネントが追加されているようにする。ページコンポーネントは
  // pages ディレクトリにあるとは限らない（たとえばプラグインが追加することもある）。
  // プラグインは、（クエリを追加する場合は）ビルド時にクエリを取り除く babel プラグインが
  // 働くように、コンポーネントを .cache にコピーする *べきである*。
  // そうしないと、コンポーネントはブラウザーで
  // "graphql is not defined" というエラーを投げる。
  files = files.concat(
    Array.from(store.getState().components.keys(), c => normalize(c))
  )

  files = _.uniq(files)

  const parser = new FileParser({ parentSpan: parentSpan })

  return await parser.parseFiles(files, addError)
}

export const processQueries = ({
  schema,
  parsedQueries,
  addError,
  parentSpan,
}) => {
  const { definitionsByName, operations } = extractOperations(
    schema,
    parsedQueries,
    addError,
    parentSpan
  )

  store.dispatch(actions.setGraphQLDefinitions(definitionsByName))

  return processDefinitions({
    schema,
    operations,
    definitionsByName,
    addError,
    parentSpan,
  })
}

const preValidationRules = [
  LoneAnonymousOperationRule,
  FragmentsOnCompositeTypesRule,
  VariablesAreInputTypesRule,
  ScalarLeafsRule,
  PossibleFragmentSpreadsRule,
  ValuesOfCorrectTypeRule,
  VariablesInAllowedPositionRule,
]

const extractOperations = (schema, parsedQueries, addError, parentSpan) => {
  const definitionsByName = new Map()
  const operations = []

  for (const {
    filePath,
    text,
    templateLoc,
    hash,
    doc: originalDoc,
    isHook,
    isStaticQuery,
    isConfigQuery,
  } of parsedQueries) {
    let doc = originalDoc

    let errors = validate(schema, doc, preValidationRules)
    if (errors && errors.length) {
      const originalQueryText = print(originalDoc)
      const { ast: transformedDocument, hasChanged } = tranformDocument(doc)
      if (hasChanged) {
        const newErrors = validate(
          schema,
          transformedDocument,
          preValidationRules
        )
        if (newErrors.length === 0) {
          report.warn(
            `Deprecated syntax of sort and/or aggregation field arguments were found in your query (see https://gatsby.dev/graphql-nested-sort-and-aggregate). Query was automatically converted to a new syntax. You should update query in your code.\n\nFile: ${filePath}\n\nCurrent query:\n\n${originalQueryText}\n\nConverted query:\n\n${print(
              transformedDocument
            )}`
          )
          doc = transformedDocument
          errors = newErrors
        }
      }
    }

    if (errors && errors.length) {
      addError(
        ...errors.map(error => {
          const location = {
            start: locInGraphQlToLocInFile(templateLoc, error.locations[0]),
          }
          return errorParser({
            message: error.message,
            filePath,
            location,
            error,
          })
        })
      )

      store.dispatch(
        actions.queryExtractionGraphQLError({
          componentPath: filePath,
        })
      )
      // このドキュメントは何かが根本的におかしいので、報告してスキップする
      continue
    }

    doc.definitions.forEach((def: any) => {
      const name = def.name.value
      let printedAst = null
      if (def.kind === Kind.OPERATION_DEFINITION) {
        operations.push({
          def,
          filePath,
          templatePath: getPathToLayoutComponent(filePath),
          hash,
        })
      } else if (def.kind === Kind.FRAGMENT_DEFINITION) {
        // この名前のフラグメントがすでに登録されているかを確認する
        printedAst = print(def)
        if (definitionsByName.has(name)) {
          const otherDef = definitionsByName.get(name)
          // たまたま重複した同じフラグメントではなく、別のフラグメントである
          // 場合は、エラーを報告する
          if (printedAst !== otherDef.printedAst) {
            addError(
              duplicateFragmentError({
                name,
                leftDefinition: {
                  def,
                  filePath,
                  text,
                  templateLoc,
                },
                rightDefinition: otherDef,
              })
            )
            // どちらを使えばよいか分からないので、両方とも失敗させるほうが
            // よい。
            definitionsByName.delete(name)
          }
          return
        }
      }

      definitionsByName.set(name, {
        name,
        def,
        filePath,
        text: text,
        templateLoc,
        printedAst,
        isHook,
        isStaticQuery,
        isConfigQuery,
        isFragment: def.kind === Kind.FRAGMENT_DEFINITION,
        hash: hash,
        templatePath: getPathToLayoutComponent(filePath),
      })
    })
  }

  return {
    definitionsByName,
    operations,
  }
}

const processDefinitions = ({
  schema,
  operations,
  definitionsByName,
  addError,
  parentSpan,
}) => {
  const processedQueries: Queries = new Map()

  const fragmentsUsedByFragment = new Map()

  const fragmentNames = Array.from(definitionsByName.entries())
    .filter(([_, def]) => def.isFragment)
    .map(([name, _]) => name)

  for (const operation of operations) {
    const { filePath, templatePath, def } = operation
    const name = def.name.value
    const originalDefinition = definitionsByName.get(name)

    const { usedFragments, missingFragments } =
      determineUsedFragmentsForDefinition(
        originalDefinition,
        definitionsByName,
        fragmentsUsedByFragment
      )

    if (missingFragments.length > 0) {
      for (const { filePath, definition, node } of missingFragments) {
        store.dispatch(
          actions.queryExtractionGraphQLError({
            componentPath: filePath,
          })
        )
        addError(
          unknownFragmentError({
            fragmentNames,
            filePath,
            definition,
            node,
          })
        )
      }
      continue
    }

    const document = {
      kind: Kind.DOCUMENT,
      definitions: Array.from(usedFragments.values())
        .map(name => definitionsByName.get(name).def)
        .concat([operation.def]),
    }

    const errors = validate(schema, document)

    if (errors && errors.length) {
      for (const error of errors) {
        const { formattedMessage, message } = graphqlError(
          definitionsByName,
          error
        )

        const filePath = originalDefinition.filePath
        store.dispatch(
          actions.queryExtractionGraphQLError({
            componentPath: filePath,
            error: formattedMessage,
          })
        )
        const location = locInGraphQlToLocInFile(
          originalDefinition.templateLoc,
          error.locations[0]
        )
        addError(
          errorParser({
            location: {
              start: location,
              end: location,
            },
            message,
            filePath,
            error,
          })
        )
      }
      continue
    }

    const printedDocument = print(document)
    // 同じコンポーネントの中で、ページクエリや静的クエリが重複していないかを確認する。
    // （config クエリは、コンポーネントの中のページクエリや静的クエリの重複とは見なさない）
    // TODO: 1 つのコンポーネントにつき、クエリの種類ごとに最大 1 つ（たとえば config が 1 つとページが 1 つ）になるようにする
    if (processedQueries.has(filePath) && !originalDefinition.isConfigQuery) {
      const otherQuery = processedQueries.get(filePath)

      if (
        templatePath !== otherQuery.templatePath ||
        printedDocument !== otherQuery.text
      ) {
        addError(
          multipleRootQueriesError(
            filePath,
            originalDefinition.def,
            otherQuery && definitionsByName.get(otherQuery.name).def
          )
        )

        store.dispatch(
          actions.queryExtractionGraphQLError({
            componentPath: filePath,
          })
        )
        continue
      }
    }

    const query = {
      name,
      text: printedDocument,
      originalText: originalDefinition.text,
      path: filePath,
      isHook: originalDefinition.isHook,
      isStaticQuery: originalDefinition.isStaticQuery,
      isConfigQuery: originalDefinition.isConfigQuery,
      templatePath,
      // hash が数値ではなく文字列になるようにする
      hash: String(originalDefinition.hash),
    }

    if (query.isStaticQuery) {
      query.id =
        `sq--` +
        _.kebabCase(
          `${path.relative(store.getState().program.directory, filePath)}`
        )
    }

    if (
      query.isHook &&
      process.env.NODE_ENV === `production` &&
      typeof require(`react`).useContext !== `function`
    ) {
      report.panicOnBuild(
        `You're likely using a version of React that doesn't support Hooks\n` +
          `Please update React and ReactDOM to 16.8.0 or later to use the useStaticQuery hook.`
      )
    }

    // 現在のコードは、1 ファイルにつき 1 つの graphql クエリ（1 ファイルにつきページクエリか静的クエリのどちらか）しか対応していない
    // そのため、config クエリは追加しない。既存のページクエリを上書きしてしまう可能性があるためである
    // TODO: ページクエリは 1 ファイルに 1 つという制限を保ちつつ、1 つのファイルに複数のクエリを書けるようにする
    if (!query.isConfigQuery) {
      processedQueries.set(filePath, query)
    }
  }

  return processedQueries
}

const determineUsedFragmentsForDefinition = (
  definition,
  definitionsByName,
  fragmentsUsedByFragment,
  traversalPath = []
) => {
  const { def, name, isFragment, filePath } = definition
  const cachedUsedFragments = fragmentsUsedByFragment.get(name)
  if (cachedUsedFragments) {
    return { usedFragments: cachedUsedFragments, missingFragments: [] }
  } else {
    const usedFragments = new Set()
    const missingFragments = []
    visit(def, {
      [Kind.FRAGMENT_SPREAD]: node => {
        const name = node.name.value
        const fragmentDefinition = definitionsByName.get(name)
        if (fragmentDefinition) {
          if (traversalPath.includes(name)) {
            // このフラグメントは、今回の走査ですでに訪れている。
            //   もう一度訪れるとスタックオーバーフローを起こす
            return
          }
          traversalPath.push(name)
          usedFragments.add(name)
          const {
            usedFragments: usedFragmentsForFragment,
            missingFragments: missingFragmentsForFragment,
          } = determineUsedFragmentsForDefinition(
            fragmentDefinition,
            definitionsByName,
            fragmentsUsedByFragment,
            traversalPath
          )
          traversalPath.pop()
          usedFragmentsForFragment.forEach(fragmentName =>
            usedFragments.add(fragmentName)
          )
          missingFragments.push(...missingFragmentsForFragment)
        } else {
          missingFragments.push({
            filePath,
            definition,
            node,
          })
        }
      },
    })
    if (isFragment) {
      fragmentsUsedByFragment.set(name, usedFragments)
    }
    return { usedFragments, missingFragments }
  }
}
