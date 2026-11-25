const r = require(`./resolver`)

function preset(context, options = {}) {
  const {
    browser = false,
    debug = false,
    nodeVersion = `22.0.0`,
    esm = false,
    availableCompilerFlags = [`GATSBY_MAJOR`],
    keepDynamicImports = null
  } = options
  const {
    NODE_ENV,
    BABEL_ENV,
    COMPILER_OPTIONS = `GATSBY_MAJOR=5`,
  } = process.env

  const IS_TEST = (BABEL_ENV || NODE_ENV) === `test`

  const browserConfig = {}

  if (browser) {
    if (esm) {
      browserConfig.targets = {
        esmodules: true,
      }
    } else {
      browserConfig.targets = {
        browsers: [`last 2 versions`, `not ie <= 11`, `not android 4.4.3`],
      }
    }
  }

  const nodeConfig = {
    targets: {
      node: nodeVersion,
    },
  }

  let parsedCompilerOptions = {}
  if (COMPILER_OPTIONS) {
    // COMPILER_OPTIONS の書式は key=value,key2=value2 である
    parsedCompilerOptions = COMPILER_OPTIONS.split(`,`).reduce((acc, curr) => {
      const [key, value] = curr.split(`=`)

      if (key) {
        acc[key] = value
      }

      return acc
    }, Object.create(null))
  }

  return {
    // Babel 8 では @babel/preset-env の loose オプションがなくなった。
    // これまでの loose: true と同じ出力になるよう、対応する assumptions を指定する
    assumptions: {
      constantReexports: true,
      constantSuper: true,
      enumerableModuleMeta: true,
      ignoreFunctionLength: true,
      ignoreToPrimitiveHint: true,
      mutableTemplateObject: true,
      noClassCalls: true,
      noClassPrototypeAssign: true,
      noConstructorPrimitiveReturn: true,
      objectRestNoSymbols: true,
      privateFieldsAsProperties: true,
      pureGetters: true,
      setClassMethods: true,
      setComputedProperties: true,
      setPublicClassFields: true,
      setSpreadProperties: true,
      skipForOfIteratorClosing: true,
      superIsCallableConstructor: true,
    },
    presets: [
      [
        r(`@babel/preset-env`),
        Object.assign(
          {
            debug: !!debug,
            // これまで @babel/plugin-proposal-optional-chaining と
            // @babel/plugin-proposal-nullish-coalescing-operator で、対象の環境に関係なく変換していた。
            // Babel 8 にはこれらのプラグインがないので、preset-env に必ず変換させる
            include: [
              `transform-optional-chaining`,
              `transform-nullish-coalescing-operator`,
            ],
            // Babel 7 の preset-env は、loose: true のときにこの変換を外していた
            exclude: [`transform-typeof-symbol`],
            shippedProposals: true,
            modules: esm ? false : `commonjs`,
          },
          browser ? browserConfig : nodeConfig
        ),
      ],
      r(`@babel/preset-flow`),
    ],
    plugins: [
      r(`@babel/plugin-transform-runtime`),
      IS_TEST && r(`babel-plugin-dynamic-import-node`),
      [
        r(`./babel-transform-compiler-flags`),
        {
          flags: parsedCompilerOptions,
          availableFlags: availableCompilerFlags,
        },
      ],
      r(`@sigmacomputing/babel-plugin-lodash`),
      r(`./babel-transform-static-import-specifier`),
      Array.isArray(keepDynamicImports) && keepDynamicImports.length > 0 && [
        r(`./babel-transform-mark-to-keep-dynamic-import`),
        {
          keepDynamicImports,
        },
      ]
    ].filter(Boolean),
    overrides: [
      {
        // Babel 8 のパーサーは、JSX が有効だと `<T>() => {}` や `<T = any>() => {}` のような
        // ジェネリックのアロー関数を構文エラーにする。.ts には JSX を書けないので、
        // .ts 以外にだけ @babel/preset-react を適用する
        exclude: /\.ts$/,
        presets: [
          // Babel 8 は既定が automatic になった。出力を変えないために classic を指定する
          [r(`@babel/preset-react`), { runtime: `classic` }],
        ],
      },
      {
        test: [`**/*.ts`, `**/*.tsx`],
        // 名前だけで指定すると、ビルドするパッケージの側から解決される。そのパッケージが
        // 別のメジャーバージョンに依存していても、このプリセットの依存を使うようにする。
        // isTSX は Babel 8 でなくなった
        plugins: [r(`@babel/plugin-transform-typescript`)],
      },
      {
        // @babel/preset-react を外した .ts でも、React.createElement() などの呼び出しに
        // これまでどおり /*#__PURE__*/ が付くようにする
        test: /\.ts$/,
        plugins: [r(`@babel/plugin-transform-react-pure-annotations`)],
      },
    ],
  }
}

module.exports = preset
