// ESLint 9 の flat config。以前の .eslintrc.js、.eslintignore、package.json の eslintIgnore、
// 各パッケージの .eslintrc.* をまとめて移したもの。ルールの内容は以前と同じにしている
const { fixupPluginRules } = require(`@eslint/compat`)
const js = require(`@eslint/js`)
const globals = require(`globals`)
const babelParser = require(`@babel/eslint-parser`)
const { builtinRules } = require(`eslint/use-at-your-own-risk`)
// @babel/eslint-plugin 8 は ESM 専用なので、require() ではプラグイン本体が default に入る
const babelEslintPlugin = require(`@babel/eslint-plugin`).default

// @babel/eslint-plugin 8 では no-invalid-this がなくなった。クラスフィールドには ESLint 本体の
// ルールが対応済みなので、本体のルールを同じ名前で登録する。各ファイルにある
// `eslint-disable @babel/no-invalid-this` をそのまま使えるようにするためである
const babelPlugin = {
  ...babelEslintPlugin,
  rules: {
    ...babelEslintPlugin.rules,
    "no-invalid-this": builtinRules.get(`no-invalid-this`),
  },
}
const tsParser = require(`@typescript-eslint/parser`)
const tsPlugin = require(`@typescript-eslint/eslint-plugin`)
const stylistic = require(`@stylistic/eslint-plugin`)
// eslint-plugin-ft-flow の一部のルールは、ESLint 9 で削除された context.getScope() などを使うので、
// @eslint/compat で補う
const ftFlow = fixupPluginRules(require(`eslint-plugin-ft-flow`))
const react = require(`eslint-plugin-react`)
const prettierPlugin = require(`eslint-plugin-prettier`)
const prettierConfig = require(`eslint-config-prettier/flat`)
const filenamesPlugin = require(`eslint-plugin-filenames`)
const googleConfig = require(`eslint-config-google`)

const TS_FILES = [`**/*.ts`, `**/*.tsx`]

// eslint-plugin-filenames（更新が止まっている）は関数形式のルールで、ESLint 9 はこの形式を
// 読み込めない。オブジェクト形式に包み、オプションの検証も無効にする（ESLint 8 も検証していなかった）
const filenames = {
  rules: Object.fromEntries(
    Object.entries(filenamesPlugin.rules).map(([name, create]) => [
      name,
      { meta: { schema: false }, create },
    ])
  ),
}

// eslint-config-google には ESLint 9 で削除された valid-jsdoc と require-jsdoc が含まれる。
// どちらも以前から無効にしていたので、設定から取り除く
const {
  "valid-jsdoc": _validJsdoc,
  "require-jsdoc": _requireJsdoc,
  ...googleRules
} = googleConfig.rules

// 以前は eslint-plugin-flowtype の recommended を使い、その書式のルールを eslint-config-prettier が
// 無効にしていた。その結果として有効だったルールだけを、後継の eslint-plugin-ft-flow で有効にする。
// eslint-config-prettier は ft-flow のルール名を知らないので、recommended をそのまま使うと書式の
// ルールが有効になってしまう。また ft-flow の recommended は parser に hermes-eslint を使い、
// no-undef も無効にするので使わない
// define-flow-type と use-flow-type は以前 warn だったが、問題を報告せず、Flow の型を定義済み、
// 使用済みとして扱うだけのルールである。ESLint 9 は --quiet のときに warn のルールを実行しないので、
// error にしておかないと、Flow の型が no-undef で報告されてしまう
const flowRules = {
  "ft-flow/define-flow-type": `error`,
  "ft-flow/no-types-missing-file-annotation": `error`,
  "ft-flow/use-flow-type": `error`,
}

module.exports = [
  {
    ignores: [
      // 以前の .eslintignore
      `**/coverage/**`,
      `**/bin/`,
      `packages/*/dist/**`,
      `packages/*/lib/**`,
      `packages/*/scripts/**`,
      `**/dist/*`,
      `**/public/*`,
      `**/__testfixtures__/**`,
      `**/__tests__/fixtures/**`,
      `**/peril`,
      `**/docs`,
      `**/starters`,
      `**/benchmarks`,
      `**/e2e-tests`,
      `**/examples`,
      `**/integration-tests`,
      `**/*.d.ts`,
      `**/deprecated-packages`,
      `packages/*/*.js`,
      `packages/gatsby-source-shopify/**/*.js`,
      `packages/gatsby-plugin-preload-fonts/prepare/*.js`,
      `packages/gatsby/cache-dir/commonjs/**/*`,
      `packages/gatsby-codemods/transforms`,
      `packages/gatsby-source-graphql/batching`,
      `packages/gatsby-plugin-preact/fast-refresh`,
      `packages/gatsby-source-wordpress/test-site/**`,
      `!packages/gatsby-worker/src/__tests__/fixtures/**`,
      // 以前の package.json の eslintIgnore
      `**/interfaces`,
      // ESLint 8 では --ext で .js、.jsx、.ts、.tsx だけを対象にしていた
      `**/*.mjs`,
      `**/*.cjs`,
      // ESLint 8 は既定でドットファイルとドットディレクトリを無視していた
      `**/.*`,
    ],
  },
  {
    // ESLint 9 が既定で対象にしない .jsx、.ts、.tsx も対象にする
    files: [`**/*.js`, `**/*.jsx`, `**/*.ts`, `**/*.tsx`],
  },
  {
    plugins: {
      "@babel": babelPlugin,
      filenames,
      "ft-flow": ftFlow,
      prettier: prettierPlugin,
    },
    languageOptions: {
      parser: babelParser,
      ecmaVersion: 2016,
      sourceType: `module`,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        babelOptions: {
          configFile: `./.babelrc.js`,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2015,
        ...globals.node,
        ...globals.jest,
        before: true,
        after: true,
        spyOn: true,
        // These should be in scope but for some reason eslint can't see them
        NodeJS: true,
        JSX: true,
        NodeRequire: true,
        TimerHandler: true,
        __PATH_PREFIX__: true,
        __BASE_PATH__: true,
        __ASSET_PREFIX__: true,
        _CFLAGS_: true,
        __GATSBY: true,
        __TRAILING_SLASH__: true,
      },
    },
    settings: {
      react: {
        version: `18.2.0`,
      },
      "ft-flow": {
        onlyFilesWithFlowAnnotation: false,
      },
    },
    // ESLint 8 は、使われていない eslint-disable コメントを報告しなかった
    linterOptions: {
      reportUnusedDisableDirectives: `off`,
    },
  },
  { rules: googleRules },
  js.configs.recommended,
  { rules: flowRules },
  react.configs.flat.recommended,
  prettierConfig,
  {
    rules: {
      "@babel/no-unused-expressions": [
        `error`,
        {
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-expressions": `off`,
      "@babel/no-invalid-this": `error`,
      "no-invalid-this": `off`,
      "arrow-body-style": [
        `error`,
        `as-needed`,
        { requireReturnForObjectLiteral: true },
      ],
      "new-cap": `off`,
      "no-unused-vars": [
        `warn`,
        {
          varsIgnorePattern: `^_`,
          argsIgnorePattern: `^_`,
          ignoreRestSiblings: true,
          // ESLint 9 で既定値が "all" に変わったので、これまでどおり catch の引数は検査しない
          caughtErrors: `none`,
        },
      ],
      "consistent-return": [`error`],
      "filenames/match-regex": [`error`, `^[a-z-\\d\\.]+$`, true],
      "no-console": `off`,
      "no-inner-declarations": `off`,
      "prettier/prettier": `error`,
      quotes: [`error`, `backtick`],
      "react/display-name": `off`,
      "react/jsx-key": `warn`,
      "react/no-unescaped-entities": `off`,
      "react/prop-types": `off`,
      "require-jsdoc": `off`,
      "valid-jsdoc": `off`,
      "prefer-promise-reject-errors": `warn`,
      "no-prototype-builtins": `warn`,
      "guard-for-in": `warn`,
      "spaced-comment": [
        `error`,
        `always`,
        { markers: [`/`], exceptions: [`*`, `+`] },
      ],
      camelcase: [
        `error`,
        {
          properties: `never`,
          ignoreDestructuring: true,
          allow: [`^unstable_`],
        },
      ],
    },
  },
  {
    files: [`packages/**/gatsby-browser.js`, `packages/gatsby/cache-dir/**/*`],
    languageOptions: {
      globals: {
        ___loader: false,
        ___emitter: false,
      },
    },
  },
  {
    files: [`**/cypress/integration/**/*`, `**/cypress/support/**/*`],
    languageOptions: {
      globals: {
        cy: false,
        Cypress: false,
      },
    },
  },
  ...tsPlugin.configs[`flat/recommended`].map(config => {
    return { ...config, files: TS_FILES }
  }),
  {
    files: TS_FILES,
    plugins: {
      "@stylistic": stylistic,
    },
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      // We should absolutely avoid using ts-ignore, but it's not always possible.
      // particular when a dependencies types are incorrect.
      "@typescript-eslint/ban-ts-comment": [
        `warn`,
        { "ts-ignore": `allow-with-description` },
      ],
      // This rule is great. It helps us not throw on types for areas that are
      // easily inferrable. However we have a desire to have all function inputs
      // and outputs declaratively typed. So this let's us ignore the parameters
      // inferrable lint.
      "@typescript-eslint/no-inferrable-types": [
        `error`,
        { ignoreParameters: true },
      ],
      // typescript-eslint 8 で ban-types が廃止されたので、no-restricted-types で同じ型を禁止する。
      // ban-types が既定で禁止していた型（Function、String など）は、recommended に含まれる
      // no-unsafe-function-type、no-wrapper-object-types、no-empty-object-type が扱う
      "@typescript-eslint/no-restricted-types": [
        `error`,
        {
          types: {
            "{}": {
              message: `Use Record<string, unknown> instead.`,
              fixWith: `Record<string, unknown>`,
            },
            object: {
              message: `Use Record<string, unknown> instead.`,
              fixWith: `Record<string, unknown>`,
            },
          },
        },
      ],
      camelcase: `off`,
      // TODO: These rules allow a lot of stuff and don't really enforce. If we want to apply our styleguide, we'd need to fix a lot of stuff
      "@typescript-eslint/naming-convention": [
        `error`,
        {
          selector: `default`,
          format: [`camelCase`],
        },
        {
          selector: `variable`,
          format: [`camelCase`, `UPPER_CASE`, `PascalCase`],
          leadingUnderscore: `allowSingleOrDouble`,
          trailingUnderscore: `allowSingleOrDouble`,
        },
        {
          selector: `function`,
          format: [`camelCase`, `PascalCase`],
          leadingUnderscore: `allow`,
        },
        {
          selector: `parameter`,
          format: [`camelCase`, `PascalCase`, `snake_case`],
          leadingUnderscore: `allowSingleOrDouble`,
        },
        {
          selector: `enumMember`,
          format: [`camelCase`, `UPPER_CASE`, `PascalCase`],
        },
        {
          selector: `typeLike`,
          format: [`PascalCase`],
        },
        {
          selector: `typeAlias`,
          format: [`camelCase`, `PascalCase`],
        },
        {
          selector: `property`,
          format: null,
        },
        {
          selector: `objectLiteralProperty`,
          format: null,
        },
        {
          selector: `enum`,
          format: [`PascalCase`, `UPPER_CASE`],
        },
        {
          selector: `method`,
          format: [`PascalCase`, `camelCase`],
          leadingUnderscore: `allowSingleOrDouble`,
        },
        {
          selector: `interface`,
          format: [`PascalCase`],
          prefix: [`I`],
        },
        // typescript-eslint 8 では default が import の名前にも適用されるようになった。
        // これまでどおり import の名前は検査しない
        {
          selector: `import`,
          format: null,
        },
      ],
      // This rule tries to prevent using `require()`. However in node code,
      // there are times where this makes sense. And it specifically is causing
      // problems in our tests where we often want this functionality for module
      // mocking. At this point it's easier to have it off and just encourage
      // using top-level imports via code reviews.
      "@typescript-eslint/no-var-requires": `off`,
      // typescript-eslint 8 では no-var-requires の代わりに no-require-imports が recommended に入った。
      // 上と同じ理由で無効にする
      "@typescript-eslint/no-require-imports": `off`,
      // typescript-eslint 8 の recommended で error になったルールを、これまでどおり warn にする
      "@typescript-eslint/no-explicit-any": `warn`,
      "@typescript-eslint/no-unused-vars": `warn`,
      // This rule ensures that typescript types do not have semicolons
      // at the end of their lines, since our prettier setup is to have no semicolons
      // e.g.,
      // interface Foo {
      // -  baz: string;
      // +  baz: string
      // }
      // typescript-eslint 8 で書式のルールが廃止されたので、@stylistic の同じルールを使う
      "@stylistic/member-delimiter-style": [
        `error`,
        {
          multiline: {
            delimiter: `none`,
          },
        },
      ],
      "@typescript-eslint/no-empty-function": `off`,
      // This ensures that we always type the return type of functions
      // a high level focus of our TS setup is typing fn inputs and outputs.
      "@typescript-eslint/explicit-function-return-type": `error`,
      // This forces us to use interfaces over types aliases for object definitions.
      // Type is still useful for opaque types
      // e.g.,
      // type UUID = string
      "@typescript-eslint/consistent-type-definitions": [`error`, `interface`],
      "@typescript-eslint/no-use-before-define": [
        `error`,
        { functions: false },
      ],
      // Allows us to write unions like `type Foo = "baz" | "bar"`
      // otherwise eslint will want to switch the strings to backticks,
      // which then crashes the ts compiler
      quotes: `off`,
      "@stylistic/quotes": [
        2,
        `backtick`,
        {
          avoidEscape: true,
        },
      ],
      // bump to @typescript-eslint/parser started showing Flow related errors in ts(x) files
      // so disabling them in .ts(x) files
      "ft-flow/no-types-missing-file-annotation": `off`,
      "@typescript-eslint/array-type": [`error`, { default: `generic` }],
    },
  },
  // 以前の各パッケージの .eslintrc.*。env の browser はルートで有効にしているので移していない
  {
    files: [`packages/gatsby/cache-dir/**/*`],
    languageOptions: {
      globals: {
        __PATH_PREFIX__: false,
        ___emitter: false,
      },
    },
  },
  {
    files: [`packages/gatsby-link/**/*`],
    languageOptions: {
      globals: {
        ___loader: false,
      },
    },
  },
  {
    files: [`packages/gatsby-plugin-layout/src/**/*`],
    languageOptions: {
      globals: {
        GATSBY_LAYOUT_COMPONENT_PATH: false,
      },
    },
  },
  {
    files: [
      `packages/gatsby-source-drupal/**/*.ts`,
      `packages/gatsby-source-drupal/**/*.tsx`,
    ],
    rules: {
      "@typescript-eslint/explicit-function-return-type": `off`,
      "@typescript-eslint/no-use-before-define": `off`,
      "@typescript-eslint/naming-convention": `off`,
      "@typescript-eslint/consistent-type-definitions": `off`,
    },
  },
]
