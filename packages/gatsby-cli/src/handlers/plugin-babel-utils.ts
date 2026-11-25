import * as t from "@babel/types"
import generate from "@babel/generator"
import template from "@babel/template"
import { declare } from "@babel/helper-plugin-utils"
import type { ConfigAPI, PluginObject } from "@babel/core"

const getKeyNameFromAttribute = (node: any): any =>
  node.key.name || node.key.value

const unwrapTemplateLiteral = (str: string): string =>
  str.trim().replace(/^`/, ``).replace(/`$/, ``)

const isLiteral = (node: any): boolean =>
  t.isLiteral(node) || t.isStringLiteral(node) || t.isNumericLiteral(node)

const getObjectFromNode = (nodeValue: any): any => {
  if (!nodeValue || !nodeValue.properties) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return getValueFromNode(nodeValue)
  }

  const props = nodeValue.properties.reduce((acc, curr) => {
    let value = null

    if (curr.value) {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      value = getValueFromNode(curr.value)
    } else if (t.isObjectExpression(curr.value)) {
      value = curr.value.expression.properties.reduce((acc, curr) => {
        acc[getKeyNameFromAttribute(curr)] = getObjectFromNode(curr)
        return acc
      }, {})
    } else {
      throw new Error(`Did not recognize ${curr}`)
    }

    acc[getKeyNameFromAttribute(curr)] = value
    return acc
  }, {})

  return props
}

const getValueFromNode = (node: any): any => {
  if (t.isTemplateLiteral(node)) {
    // @ts-ignore - fix me
    delete node.leadingComments
    // @ts-ignore - fix me
    delete node.trailingComments
    // @ts-ignore - fix me
    const literalContents = generate(node).code
    return unwrapTemplateLiteral(literalContents)
  }

  if (isLiteral(node)) {
    return node.value
  }

  if (node.type === `ArrayExpression`) {
    return node.elements.map(getObjectFromNode)
  }

  if (node.type === `ObjectExpression`) {
    return getObjectFromNode(node)
  }

  return null
}

function isDefaultExport(node): boolean {
  if (!node || !t.isMemberExpression(node)) {
    return false
  }

  const { object, property } = node

  if (!t.isIdentifier(object) || object.name !== `module`) return false
  if (!t.isIdentifier(property) || property.name !== `exports`) return false

  return true
}

const getOptionsForPlugin = (node: any): any => {
  if (!t.isObjectExpression(node) && !t.isLogicalExpression(node)) {
    return undefined
  }

  let options

  // プラグインが && {} で条件付きで追加されている場合
  if (t.isLogicalExpression(node)) {
    // @ts-ignore - fix me
    options = node.right.properties.find(
      property => property.key.name === `options`
    )
  } else {
    // @ts-ignore - fix me
    options = node.properties.find(property => property.key.name === `options`)
  }

  if (options) {
    return getObjectFromNode(options.value)
  }

  return undefined
}

const getKeyForPlugin = (node: any): any => {
  if (t.isObjectExpression(node)) {
    // @ts-ignore - fix me
    const key = node.properties.find(p => p.key.name === `__key`)

    // @ts-ignore - fix me
    return key ? getValueFromNode(key.value) : null
  }

  // プラグインが && {} で条件付きで追加されている場合
  if (t.isLogicalExpression(node)) {
    // @ts-ignore - fix me
    const key = node.right.properties.find(p => p.key.name === `__key`)

    return key ? getValueFromNode(key.value) : null
  }

  return null
}

const getNameForPlugin = (node: any): any => {
  if (t.isStringLiteral(node) || t.isTemplateLiteral(node)) {
    return getValueFromNode(node)
  }

  if (t.isObjectExpression(node)) {
    // @ts-ignore - fix me
    const resolve = node.properties.find(p => p.key.name === `resolve`)

    // @ts-ignore - fix me
    return resolve ? getValueFromNode(resolve.value) : null
  }

  // プラグインが && {} で条件付きで追加されている場合
  if (t.isLogicalExpression(node)) {
    // @ts-ignore - fix me
    const resolve = node.right.properties.find(p => p.key.name === `resolve`)

    return resolve ? getValueFromNode(resolve.value) : null
  }

  return null
}

const getPlugin = (node: any): any => {
  const plugin = {
    name: getNameForPlugin(node),
    options: getOptionsForPlugin(node),
  }

  const key = getKeyForPlugin(node)

  if (key) {
    return { ...plugin, key }
  }

  return plugin
}

function buildPluginNode({ name, options, key }): any {
  if (!options && !key) {
    return t.stringLiteral(name)
  }

  const pluginWithOptions = template(
    `
    const foo = {
      resolve: '${name}',
      options: ${JSON.stringify(options, null, 2)},
      ${key ? `__key: "` + key + `"` : ``}
    }
  `,
    { placeholderPattern: false }
  )()

  // @ts-ignore - fix me
  return pluginWithOptions.declarations[0].init
}

function addPluginsToConfig({
  pluginNodes,
  pluginOrThemeName,
  options,
  key,
}): void {
  if (t.isCallExpression(pluginNodes.value)) {
    const plugins = pluginNodes.value.callee.object.elements.map(getPlugin)
    const matches = plugins.filter(plugin => {
      if (!key) {
        return plugin.name === pluginOrThemeName
      }

      return plugin.key === key
    })

    if (!matches.length) {
      const pluginNode = buildPluginNode({
        name: pluginOrThemeName,
        options,
        key,
      })

      pluginNodes.value.callee.object.elements.push(pluginNode)
    } else {
      pluginNodes.value.callee.object.elements =
        pluginNodes.value.callee.object.elements.map(node => {
          const plugin = getPlugin(node)

          if (plugin.key !== key) {
            return node
          }

          if (!plugin.key && plugin.name !== pluginOrThemeName) {
            return node
          }

          return buildPluginNode({
            name: pluginOrThemeName,
            options,
            key,
          })
        })
    }
  } else {
    const plugins = pluginNodes.value.elements.map(getPlugin)
    const matches = plugins.filter(plugin => {
      if (!key) {
        return plugin.name === pluginOrThemeName
      }

      return plugin.key === key
    })

    if (!matches.length) {
      const pluginNode = buildPluginNode({
        name: pluginOrThemeName,
        options,
        key,
      })

      pluginNodes.value.elements.push(pluginNode)
    } else {
      pluginNodes.value.elements = pluginNodes.value.elements.map(node => {
        const plugin = getPlugin(node)

        if (plugin.key !== key) {
          return node
        }

        if (!plugin.key && plugin.name !== pluginOrThemeName) {
          return node
        }

        return buildPluginNode({
          name: pluginOrThemeName,
          options,
          key,
        })
      })
    }
  }
}

function getPluginNodes(
  properties: Array<t.ObjectProperty | t.ObjectMethod | t.SpreadElement>
): t.ObjectProperty | undefined {
  return properties.find(
    prop =>
      t.isObjectProperty(prop) &&
      t.isIdentifier(prop.key) &&
      prop.key.name === `plugins`
  ) as t.ObjectProperty
}

/**
 * create-gatsby の質問で選ばれたプラグインを `gatsby-config` ファイルに挿入する。
 *
 * 対象は `gatsby-starter-minimal` と `gatsby-starter-minimal-ts` の `gatsby-config` ファイルに
 * 限られる。ほかの `gatsby-config` ファイルでの一般的な利用には対応していない。
 * これらのファイルの設定オブジェクトを変更した場合は、このトランスフォーマーも変更が必要になることがある。
 *
 * @see {@link https://github.com/gatsbyjs/gatsby/blob/master/starters/gatsby-starter-minimal/gatsby-config.js}
 * @see {@link https://github.com/gatsbyjs/gatsby/blob/master/starters/gatsby-starter-minimal-ts/gatsby-config.ts}
 */
export default declare(
  (
    api: ConfigAPI,
    args: {
      pluginOrThemeName: string
      options: unknown
      key: string
    }
  ): PluginObject => {
    api.assertVersion(8)

    return {
      visitor: {
        /**
         * `gatsby-starter-minimal` の `gatsby-config.js` にある `module.exports = { ..., plugins: [] }` を処理する。
         * @see {@link https://github.com/gatsbyjs/gatsby/blob/master/starters/gatsby-starter-minimal/gatsby-config.js}
         */
        ExpressionStatement(path): void {
          const { node } = path
          if (!t.isAssignmentExpression(node.expression)) {
            return
          }

          const { left, right } = node.expression
          if (!isDefaultExport(left) || !t.isObjectExpression(right)) {
            return
          }

          const pluginNodes = getPluginNodes(right.properties)

          if (
            !t.isObjectProperty(pluginNodes) ||
            !t.isArrayExpression(pluginNodes.value)
          ) {
            return
          }

          addPluginsToConfig({ pluginNodes, ...args })

          path.stop()
        },

        /**
         * `gatsby-starter-minimal-ts` の `gatsby-config.ts` にある `const config = { ..., plugins: [] }; export default config` を処理する。
         * @see {@link https://github.com/gatsbyjs/gatsby/blob/master/starters/gatsby-starter-minimal-ts/gatsby-config.ts}
         */
        VariableDeclaration(path): void {
          const { node } = path
          const configDeclaration = node.declarations.find(
            dec =>
              t.isIdentifier(dec.id) && dec.id.name === `config` && dec.init
          )
          const config = configDeclaration?.init
          if (!t.isObjectExpression(config)) {
            return
          }

          const pluginNodes = getPluginNodes(config.properties)

          if (
            !t.isObjectProperty(pluginNodes) ||
            !t.isArrayExpression(pluginNodes.value)
          ) {
            return
          }

          addPluginsToConfig({ pluginNodes, ...args })

          path.stop()
        },
      },
    }
  }
)
