import type { ESLint, Linter } from "eslint"
import globals from "globals"
import { fixupPluginRules } from "@eslint/compat"
import { reactAppRules } from "./eslint/react-app-rules"

// パーサーとプラグインは CommonJS のモジュールで、`default` の有無がそろっていないので、require で読み込む
const babelParser: Linter.Parser = require(`@babel/eslint-parser`)
const reactPlugin: ESLint.Plugin = require(`eslint-plugin-react`)
const reactHooksPlugin: ESLint.Plugin = require(`eslint-plugin-react-hooks`)
const importPlugin: ESLint.Plugin = require(`eslint-plugin-import`)
const jsxA11yPlugin: ESLint.Plugin = require(`eslint-plugin-jsx-a11y`)
// eslint-plugin-ft-flow の一部のルールは、ESLint 9 で削除された context.getScope() などを使うので、
// @eslint/compat で補う（@eslint/compat の `Plugin` 型は ESLint の型と細部が合わないので、型を付け直している）
const ftFlowPlugin = fixupPluginRules(
  require(`eslint-plugin-ft-flow`)
) as unknown as ESLint.Plugin

// Gatsby 独自の ESLint ルール。flat config ではルールをプラグインとして渡す必要があるので、
// `gatsby` という名前のプラグインにまとめている（ルール名は `gatsby/<ルール名>` になる）
const gatsbyPlugin: ESLint.Plugin = {
  rules: {
    "no-anonymous-exports-page-templates": require(
      `./eslint-rules/no-anonymous-exports-page-templates`
    ),
    "limited-exports-page-templates": require(
      `./eslint-rules/limited-exports-page-templates`
    ),
  },
}

const requiredRules: Linter.RulesRecord = {
  "gatsby/no-anonymous-exports-page-templates": `warn`,
  "gatsby/limited-exports-page-templates": `warn`,
}

// flat config は、`files` に一致しない拡張子（`.jsx` など）を検査の対象にしない
const files = [`**/*.{js,jsx,mjs,cjs}`]

const gatsbyGlobals: Linter.Globals = {
  graphql: true,
  __PATH_PREFIX__: true,
  __TRAILING_SLASH__: true,
  __BASE_PATH__: true, // 利用者がこれを使うことは、あったとしてもまれである
}

const languageOptions: Linter.LanguageOptions = {
  parser: babelParser,
  ecmaVersion: 2020,
  sourceType: `module`,
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    // TODO 独自の babel とプラグインの設定を正しく確認する
    // 現状では、プロジェクトに babelrc が追加されると、こちらの babelOptions が上書きされる
    babelOptions: {
      presets: [require.resolve(`babel-preset-gatsby`)],
    },
    requireConfigFile: false,
  },
}

// ESLint 9 は、使われていない `eslint-disable` コメントを既定で警告する。ESLint 7 のときと同じく、警告しない
// eslintrc 形式の ESLint は、ドットで始まるファイルとディレクトリ（`.cache` など）を
// 既定で対象から外していた。flat config にはこの既定がないため、同じ対象になるように指定する
const ignoredFiles: Linter.Config = {
  ignores: [`**/.*`],
}

const linterOptions: Linter.LinterOptions = {
  reportUnusedDisableDirectives: `off`,
}

// eslint-webpack-plugin に渡すオプション。ESLint のオプションに、プラグイン自身のオプション（`emitWarning`）が加わる
type ESLintPluginOptions = ESLint.Options & { emitWarning?: boolean }

export const eslintRequiredConfig: ESLintPluginOptions = {
  // サイトの `eslint.config.js` は読み込まない
  overrideConfigFile: true,
  allowInlineConfig: false,
  emitWarning: true,
  baseConfig: [
    ignoredFiles,
    {
      files,
      plugins: {
        gatsby: gatsbyPlugin,
      },
      languageOptions: {
        ...languageOptions,
        globals: gatsbyGlobals,
      },
      linterOptions,
      rules: requiredRules,
    },
  ],
}

export const eslintConfig = (
  usingAutomaticJsxRuntime: boolean
): ESLintPluginOptions => {
  return {
    // サイトの `eslint.config.js` は読み込まない
    overrideConfigFile: true,
    baseConfig: [
      ignoredFiles,
      {
        files,
        plugins: {
          gatsby: gatsbyPlugin,
          react: reactPlugin,
          "react-hooks": reactHooksPlugin,
          import: importPlugin,
          "jsx-a11y": jsxA11yPlugin,
          "ft-flow": ftFlowPlugin,
        },
        languageOptions: {
          ...languageOptions,
          globals: {
            // eslint-config-react-app の `env`（browser、commonjs、es6、jest、node）にあたる
            ...globals.browser,
            ...globals.commonjs,
            ...globals.es2015,
            ...globals.jest,
            ...globals.node,
            ...gatsbyGlobals,
          },
        },
        linterOptions,
        settings: {
          react: {
            version: `detect`,
          },
        },
        rules: {
          ...reactAppRules,
          ...requiredRules,
          // 新しいバージョンの react は特別な jsx ランタイムを使っており、jsx のために
          // react をスコープに入れておく必要がなくなった。jsx ランタイムがすべての
          // バージョンの react にバックポートされたら、これを常に `off` にできる。
          // jsx ランタイムが React の一般的なすべてのバージョンで安定したら、eslint-config-react-app も
          // フラグを `off` に切り替えるだろうと思われる。
          "react/jsx-uses-react": usingAutomaticJsxRuntime ? `off` : `error`,
          "react/react-in-jsx-scope": usingAutomaticJsxRuntime
            ? `off`
            : `error`,
          "import/no-webpack-loader-syntax": [0],
          // ESLint 9 で既定値が変わったオプションを、これまでの既定値に合わせる
          "no-unused-vars": [
            `warn`,
            {
              args: `none`,
              ignoreRestSiblings: true,
              caughtErrors: `none`,
            },
          ],
          "no-useless-computed-key": [
            `warn`,
            { enforceForClassMembers: false },
          ],
          "react/jsx-pascal-case": [
            `warn`,
            {
              allowNamespace: true,
            },
          ],
          // https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/tree/master/docs/rules
          // "jsx-a11y/accessible-emoji": `warn`, Deprecated
          "jsx-a11y/alt-text": `warn`,
          "jsx-a11y/anchor-has-content": `warn`,
          // オプションは eslint-config-react-app のもの。flat config では、同じオブジェクトの中で
          // ルールを書き直すとオプションごと置き換わるので、ここにも書いている
          "jsx-a11y/anchor-is-valid": [
            `warn`,
            {
              aspects: [`noHref`, `invalidHref`],
            },
          ],
          "jsx-a11y/aria-activedescendant-has-tabindex": `warn`,
          "jsx-a11y/aria-props": `warn`,
          "jsx-a11y/aria-proptypes": `warn`,
          "jsx-a11y/aria-role": [`warn`, { ignoreNonDOM: true }],
          "jsx-a11y/aria-unsupported-elements": `warn`,
          "jsx-a11y/autocomplete-valid": [
            `warn`,
            {
              inputComponents: [],
            },
          ],
          "jsx-a11y/click-events-have-key-events": `warn`,
          "jsx-a11y/control-has-associated-label": [
            `warn`,
            {
              ignoreElements: [
                `audio`,
                `canvas`,
                `embed`,
                `input`,
                `textarea`,
                `tr`,
                `video`,
              ],
              ignoreRoles: [
                `grid`,
                `listbox`,
                `menu`,
                `menubar`,
                `radiogroup`,
                `row`,
                `tablist`,
                `toolbar`,
                `tree`,
                `treegrid`,
              ],
              includeRoles: [`alert`, `dialog`],
            },
          ],
          "jsx-a11y/heading-has-content": `warn`,
          "jsx-a11y/html-has-lang": `warn`,
          "jsx-a11y/iframe-has-title": `warn`,
          "jsx-a11y/img-redundant-alt": `warn`,
          "jsx-a11y/interactive-supports-focus": [
            `warn`,
            {
              tabbable: [
                `button`,
                `checkbox`,
                `link`,
                `progressbar`,
                `searchbox`,
                `slider`,
                `spinbutton`,
                `switch`,
                `textbox`,
              ],
            },
          ],
          // "jsx-a11y/label-has-for": `warn`, was deprecated and replaced with jsx-a11y/has-associated-control in v6.1.0
          "jsx-a11y/label-has-associated-control": `warn`,
          "jsx-a11y/lang": `warn`,
          "jsx-a11y/media-has-caption": `warn`,
          "jsx-a11y/mouse-events-have-key-events": `warn`,
          "jsx-a11y/no-access-key": `warn`,
          "jsx-a11y/no-autofocus": `warn`,
          "jsx-a11y/no-distracting-elements": `warn`,
          "jsx-a11y/no-interactive-element-to-noninteractive-role": `warn`,
          "jsx-a11y/no-noninteractive-element-interactions": [
            `warn`,
            {
              body: [`onError`, `onLoad`],
              iframe: [`onError`, `onLoad`],
              img: [`onError`, `onLoad`],
            },
          ],
          "jsx-a11y/no-noninteractive-element-to-interactive-role": `warn`,
          "jsx-a11y/no-noninteractive-tabindex": `warn`,
          // "jsx-a11y/no-onchange": `warn`, Deprecated
          "jsx-a11y/no-redundant-roles": `warn`,
          "jsx-a11y/no-static-element-interactions": `warn`,
          "jsx-a11y/role-has-required-aria-props": `warn`,
          "jsx-a11y/role-supports-aria-props": `warn`,
          "jsx-a11y/scope": `warn`,
          "jsx-a11y/tabindex-no-positive": `warn`,
        },
      },
    ],
  }
}
